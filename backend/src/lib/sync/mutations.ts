import type { Env, SyncConflict, SyncMutation } from '../../types';
import {
  type ApplyMutationResult,
  type TableKey,
  VERSION_GUARD_SQL,
  MutationPatchError,
  entityNotFoundConflict,
  tableFor,
  versionConflict,
  versionGuardBindings,
} from './shared';
import { entityExists } from './queries';
import {
  prepareCasIncrementVersion,
  prepareIncrementVersion,
  prepareInsert,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
  prepareReadEntityVersion,
  prepareSoftDelete,
  prepareUpdate,
  isUniqueMutationIdViolation,
} from './statements';
import type { ChangeLogRow } from './moveFanOut';

/** The fixed client-visible message used for every invalid-patch conflict. */
export const INVALID_MUTATION_PATCH_MESSAGE = 'Invalid mutation patch';

export function invalidPatchConflict(
  mutation: SyncMutation,
  currentVersion: number
): SyncConflict {
  return {
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    clientMutationId: mutation.clientMutationId,
    message: INVALID_MUTATION_PATCH_MESSAGE,
    currentVersion,
    expectedVersion: mutation.baseVersion,
  };
}

/**
 * Version-guard descriptor for the change-log inserts accompanying a CAS
 * write. The guard always references the ENTITY's version row (which, for
 * applied mutations, lives in the route's project), even for fan-out rows
 * addressed to a different project's change log.
 */
function guardFor(mutation: SyncMutation, baseVersion: number) {
  return {
    projectId: mutation.projectId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    version: baseVersion,
  };
}

/**
 * Commit one mutation atomically: [version read] + entity write + change-log
 * insert(s) + version bump, in a single D1 batch (statements run sequentially
 * inside one transaction).
 *
 * - CAS path (`baseVersion` defined): the entity write, every change-log row
 *   AND the version bump carry the same `version = baseVersion` guard, so a
 *   lost race commits NOTHING; the 0-changes CAS result is the authoritative
 *   conflict signal, and the in-batch read supplies the authoritative
 *   `currentVersion` for the conflict message.
 * - Legacy path (delete without `baseVersion`): unguarded write + unconditional
 *   upsert bump — same semantics as before mandatory CAS on updates.
 *
 * A UNIQUE violation on sync_changes (migration 0004's
 * (project_id, client_mutation_id) index) means the same mutation already
 * committed — a replay that raced past the pre-check. It maps to an idempotent
 * SUCCESS: the batch is rolled back by D1 and the caller sees `applied`.
 */
export async function commitEntityBatch(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string,
  entityStmt: D1PreparedStatement,
  fanOut: ChangeLogRow[] | null,
  baseVersion: number | undefined
): Promise<ApplyMutationResult> {
  const guard =
    baseVersion === undefined ? undefined : guardFor(mutation, baseVersion);
  const statements: D1PreparedStatement[] = [];

  if (guard) {
    // In-batch read: authoritative currentVersion for a CAS-conflict message.
    statements.push(
      prepareReadEntityVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId
      )
    );
  }
  statements.push(entityStmt);
  if (fanOut) {
    for (const row of fanOut) {
      statements.push(
        prepareInsertSyncChangeRow(
          env,
          actorId,
          mutation,
          row.projectId,
          row.operation,
          row.patch,
          now,
          guard
        )
      );
    }
  } else {
    statements.push(prepareInsertSyncChange(env, actorId, mutation, now, guard));
  }
  if (guard) {
    statements.push(
      prepareCasIncrementVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId,
        now,
        baseVersion as number
      )
    );
  } else {
    statements.push(
      prepareIncrementVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId,
        now
      )
    );
  }

  let results: { meta?: { changes?: number } }[];
  try {
    results = (await env.D1_DATABASE.batch(
      statements
    )) as { meta?: { changes?: number } }[];
  } catch (error) {
    // Concurrent replay of the same (project_id, client_mutation_id): the
    // mutation is already applied. D1 rolled the batch back; answer success.
    if (isUniqueMutationIdViolation(error)) return {};
    throw error;
  }

  if (guard) {
    // The CAS bump is always the LAST statement of a guarded batch.
    const cas = results[results.length - 1];
    if ((cas?.meta?.changes ?? 0) === 0) {
      const read = results[0] as { results?: { version?: number }[] } | undefined;
      return {
        conflict: versionConflict(mutation, read?.results?.[0]?.version ?? 0),
      };
    }
  }

  return {};
}

export async function applyProjectMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string
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

  const baseVersion = mutation.baseVersion;
  const guarded = baseVersion !== undefined;

  if (mutation.operation === 'delete') {
    // Reconcile the soft-delete basis: an already soft-deleted project is "not
    // present", so return a clean not-found conflict instead of running the
    // guarded UPDATE (which matches 0 rows) while still committing a phantom
    // version bump and a spurious `delete` change-log row. Scoped to the
    // mutation's project (which equals the route's project for applied
    // mutations).
    const liveProject = await env.D1_DATABASE.prepare(
      'SELECT id FROM projects WHERE id = ? AND project_id = ? AND deleted_at IS NULL'
    )
      .bind(mutation.entityId, mutation.projectId)
      .first<{ id: string }>();
    if (!liveProject) {
      return { conflict: entityNotFoundConflict(mutation, 0) };
    }

    const { requireMinRole, getMembershipRole, countMembers } = await import(
      '../membership'
    );
    const role = await getMembershipRole(env, actorId, mutation.projectId);
    if (!requireMinRole(role, 'owner')) {
      return {
        conflict: {
          entityType: 'project',
          entityId: mutation.entityId,
          clientMutationId: mutation.clientMutationId,
          message: 'Project deletion requires owner role',
          currentVersion: baseVersion ?? 0,
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
          currentVersion: baseVersion ?? 0,
          expectedVersion: mutation.baseVersion,
        },
      };
    }

    const deleteStmt = env.D1_DATABASE.prepare(
      `
      UPDATE projects
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL${guarded ? ` ${VERSION_GUARD_SQL}` : ''}
      `
    ).bind(
      now,
      now,
      mutation.entityId,
      mutation.projectId,
      ...(guarded
        ? versionGuardBindings(
            mutation.projectId,
            'project',
            mutation.entityId,
            baseVersion as number
          )
        : [])
    );

    return commitEntityBatch(env, actorId, mutation, now, deleteStmt, null, mutation.baseVersion);
  }

  // Update: project-scoped row read for the field merge.
  const existing = await env.D1_DATABASE.prepare(
    'SELECT name, description, color, icon FROM projects WHERE id = ? AND project_id = ? AND deleted_at IS NULL'
  )
    .bind(mutation.entityId, mutation.projectId)
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

  // Mandatory baseVersion for updates: never apply without a CAS basis.
  if (baseVersion === undefined) {
    return { skipped: { reason: 'missing_base_version' } };
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
        currentVersion: baseVersion,
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

  const updateStmt = env.D1_DATABASE.prepare(
    `
    UPDATE projects
    SET name = ?, description = ?, color = ?, icon = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL ${VERSION_GUARD_SQL}
    `
  ).bind(
    name,
    description,
    color,
    icon,
    now,
    mutation.entityId,
    mutation.projectId,
    ...versionGuardBindings(
      mutation.projectId,
      'project',
      mutation.entityId,
      baseVersion
    )
  );

  return commitEntityBatch(env, actorId, mutation, now, updateStmt, null, baseVersion);
}

export async function buildCreateStatements(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string,
  /**
   * Optional quota guard. When supplied, the INSERT only commits while the
   * project's live entity total plus `guardArgs[0]` stays within
   * `guardArgs[1]` (atomic check-and-insert). When `undefined` the INSERT is
   * plain — used for creates that are already bounded by the caller's cached
   * per-request headroom (only the boundary create still needs the guard).
   */
  guardSql: string | undefined,
  guardArgs: unknown[] | undefined,
  exists: boolean,
  currentVersion: number
): Promise<
  | { statements: D1PreparedStatement[] }
  | { conflict: SyncConflict }
  | { alreadyApplied: true }
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
    // Migration 0004 replay key: if this exact (project, clientMutationId) was
    // already applied, the resubmission is an idempotent SUCCESS — not an
    // "entity already exists" conflict (the entity exists BECAUSE of it).
    const replayed = await env.D1_DATABASE.prepare(
      'SELECT id FROM sync_changes WHERE project_id = ? AND client_mutation_id = ?'
    )
      .bind(mutation.projectId, mutation.clientMutationId)
      .first<{ id: number }>();
    if (replayed) return { alreadyApplied: true as const };

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
      guardSql,
      guardArgs
    );
    if ('conflict' in built) return { conflict: built.conflict };
    entityStmt = built.stmt;
  } catch (error) {
    // Only the engine's own invalid-patch signals become conflicts (with a
    // fixed message); infrastructure failures propagate to the top-level
    // handler instead of being disguised as client-data conflicts.
    if (!(error instanceof MutationPatchError)) throw error;
    return { conflict: invalidPatchConflict(mutation, currentVersion) };
  }

  // When `guardSql` was supplied, `entityStmt` only commits while live
  // capacity remains. The version bump and sync_changes row follow it in the
  // same batch, so dependents never outlive a guard that tripped.
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
 *
 * Every read and write is scoped to the mutation's project (which the route
 * has already matched against the sync project), and every UPDATE/DELETE is
 * CAS-guarded when the mutation carries a `baseVersion`.
 */
export async function buildEntityStatement(
  env: Env,
  table: TableKey,
  mutation: SyncMutation,
  now: string,
  guardSql?: string,
  guardArgs?: unknown[]
): Promise<{ stmt: D1PreparedStatement } | { conflict: SyncConflict }> {
  switch (mutation.operation) {
    case 'delete': {
      const exists = await entityExists(
        env,
        table,
        mutation.entityId,
        mutation.projectId
      );
      if (!exists)
        return { conflict: entityNotFoundConflict(mutation, 0) };
      return {
        stmt: prepareSoftDelete(
          env,
          table,
          mutation.entityId,
          mutation.projectId,
          now,
          mutation.entityType,
          mutation.baseVersion
        ),
      };
    }
    case 'create': {
      if (
        await entityExists(env, table, mutation.entityId, mutation.projectId)
      ) {
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
      return {
        stmt: prepareInsert(env, mutation, now, guardSql, guardArgs),
      };
    }
    case 'update':
    default: {
      const stmt = await prepareUpdate(
        env,
        mutation,
        mutation.projectId,
        now,
        mutation.baseVersion
      );
      if (!stmt)
        return { conflict: entityNotFoundConflict(mutation, 0) };
      return { stmt };
    }
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
