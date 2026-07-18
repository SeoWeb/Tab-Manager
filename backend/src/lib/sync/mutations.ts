import type { Env, SyncConflict, SyncMutation } from '../../types';
import {
  type ApplyMutationResult,
  type TableKey,
  entityNotFoundConflict,
  tableFor,
} from './shared';
import { entityExists } from './queries';
import {
  prepareIncrementVersion,
  prepareInsert,
  prepareInsertSyncChange,
  prepareUpdate,
} from './statements';

export async function applyProjectMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string,
  currentVersion: number
): Promise<ApplyMutationResult> {
  if (mutation.operation === 'create') {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message:
          'Create projects through POST /projects instead of the sync endpoint',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  if (mutation.operation === 'delete') {
    // Reconcile the soft-delete basis: an already soft-deleted project is "not
    // present", so return a clean not-found conflict instead of running the
    // guarded UPDATE (which matches 0 rows) while still committing a phantom
    // version bump and a spurious `delete` change-log row.
    const liveProject = await env.D1_DATABASE.prepare(
      'SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL'
    )
      .bind(mutation.entityId)
      .first<{ id: string }>();
    if (!liveProject) {
      return { conflict: entityNotFoundConflict(mutation, currentVersion) };
    }

    const { requireMinRole, getMembershipRole, countMembers } = await import(
      '../membership'
    );
    const role = await getMembershipRole(env, actorId, mutation.projectId);
    if (!requireMinRole(role, 'admin')) {
      return {
        conflict: {
          entityType: 'project',
          entityId: mutation.entityId,
          clientMutationId: mutation.clientMutationId,
          message: 'Project deletion requires admin role or higher',
          currentVersion,
          expectedVersion: mutation.baseVersion,
        },
      };
    }
    const memberCount = await countMembers(env, mutation.projectId);
    if (memberCount > 1) {
      return {
        conflict: {
          entityType: 'project',
          entityId: mutation.entityId,
          clientMutationId: mutation.clientMutationId,
          message: 'Cannot delete project with multiple members',
          currentVersion,
          expectedVersion: mutation.baseVersion,
        },
      };
    }
    await env.D1_DATABASE.batch([
      env.D1_DATABASE.prepare(
        'UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      ).bind(now, now, mutation.entityId),
      prepareIncrementVersion(
        env,
        mutation.projectId,
        'project',
        mutation.entityId,
        now
      ),
      prepareInsertSyncChange(env, actorId, mutation, now),
    ]);
    return {};
  }

  const existing = await env.D1_DATABASE.prepare(
    'SELECT name, description, color, icon FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(mutation.entityId)
    .first<{
      name: string;
      description: string | null;
      color: string | null;
      icon: string | null;
    }>();

  if (!existing) {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Project not found',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const name =
    mutation.patch.name === undefined ? existing.name : mutation.patch.name;
  if (typeof name !== 'string' || !name.trim()) {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Project name must be a non-empty string',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const description =
    mutation.patch.description === undefined
      ? existing.description
      : optionalString(mutation.patch.description);
  const color =
    mutation.patch.color === undefined
      ? existing.color
      : optionalString(mutation.patch.color);
  const icon =
    mutation.patch.icon === undefined
      ? existing.icon
      : optionalString(mutation.patch.icon);

  await env.D1_DATABASE.batch([
    env.D1_DATABASE.prepare(
      'UPDATE projects SET name = ?, description = ?, color = ?, icon = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).bind(name, description, color, icon, now, mutation.entityId),
    prepareIncrementVersion(
      env,
      mutation.projectId,
      'project',
      mutation.entityId,
      now
    ),
    prepareInsertSyncChange(env, actorId, mutation, now),
  ]);

  return {};
}

export async function buildCreateStatements(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string,
  guardSql: string,
  guardArgs: unknown[],
  exists: boolean,
  currentVersion: number
): Promise<
  { statements: D1PreparedStatement[] } | { conflict: SyncConflict }
> {
  const table = tableFor(mutation.entityType);
  if (!table) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Unsupported entity type',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  if (exists) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Entity already exists',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  let entityStmt: D1PreparedStatement;
  try {
    const built = await buildEntityStatement(
      env,
      table,
      mutation,
      now,
      currentVersion,
      guardSql,
      guardArgs
    );
    if ('conflict' in built) return { conflict: built.conflict };
    entityStmt = built.stmt;
  } catch (error) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message:
          error instanceof Error ? error.message : 'Invalid mutation patch',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  // `entityStmt` is already guarded by `guardSql` (the live entity count), so it
  // only commits when capacity remains. The version bump and sync_changes row
  // follow it in the same batch, so at most the available capacity is created
  // and the quota cannot be overshot by concurrent syncs.
  return {
    statements: [
      entityStmt,
      prepareIncrementVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId,
        now
      ),
      prepareInsertSyncChange(env, actorId, mutation, now),
    ],
  };
}

/**
 * Build the prepared statement that performs the entity write for a mutation.
 * Pure reads (existence checks, current-row merge) happen here; nothing is
 * committed until the caller runs the returned statement in a batch.
 */
export async function buildEntityStatement(
  env: Env,
  table: TableKey,
  mutation: SyncMutation,
  now: string,
  currentVersion: number,
  guardSql?: string,
  guardArgs?: unknown[]
): Promise<{ stmt: D1PreparedStatement } | { conflict: SyncConflict }> {
  switch (mutation.operation) {
    case 'delete': {
      const exists = await entityExists(env, table, mutation.entityId);
      if (!exists)
        return { conflict: entityNotFoundConflict(mutation, currentVersion) };
      return {
        stmt: env.D1_DATABASE.prepare(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).bind(now, now, mutation.entityId),
      };
    }
    case 'create': {
      if (await entityExists(env, table, mutation.entityId)) {
        return {
          conflict: {
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            clientMutationId: mutation.clientMutationId,
            message: 'Entity already exists',
            currentVersion,
            expectedVersion: mutation.baseVersion,
          },
        };
      }
      return {
        stmt: prepareInsert(env, mutation, now, guardSql, guardArgs),
      };
    }
    case 'update':
    default: {
      const stmt = await prepareUpdate(env, mutation, now);
      if (!stmt)
        return { conflict: entityNotFoundConflict(mutation, currentVersion) };
      return { stmt };
    }
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
