import type { Env, SyncMutation } from '../../types';
import {
  type ApplyMutationResult,
  entityNotFoundConflict,
  jsonTableFor,
  nowIso,
  tableFor,
} from './shared';
import { entityExists, getEntityVersion } from './queries';
import {
  applyProjectMutation,
  buildEntityStatement,
} from './mutations';
import {
  prepareIncrementVersion,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
} from './statements';
import { describeMoveFanOut } from './moveFanOut';

/**
 * Apply a single client mutation idempotently. The entity write, the per-entity
 * version bump, and the append-only sync_changes row are committed together in
 * one D1 batch so a failure can never leave the change log out of sync with the
 * entity state.
 */
export async function applyMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation
): Promise<ApplyMutationResult> {
  const existingMutation = await env.D1_DATABASE.prepare(
    'SELECT id FROM sync_changes WHERE client_mutation_id = ?'
  )
    .bind(mutation.clientMutationId)
    .first<{ id: number }>();

  if (existingMutation) {
    return {};
  }

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

  const currentVersion = await getEntityVersion(
    env,
    mutation.projectId,
    mutation.entityType,
    mutation.entityId
  );

  // Reconcile the soft-delete basis: a soft-deleted entity is "not present" for
  // mutation purposes, matching the live-only entity-write and quota layers. We
  // resolve presence on the live basis BEFORE the version guard so an
  // update/delete targeting a tombstone always yields a clean "not found /
  // already deleted" conflict, instead of leaking the tombstone's version into
  // the version-conflict path. Projects are handled by applyProjectMutation.
  if (
    mutation.operation !== 'create' &&
    mutation.entityType !== 'project' &&
    !(await entityExists(env, table, mutation.entityId))
  ) {
    return { conflict: entityNotFoundConflict(mutation, currentVersion) };
  }

  if (
    mutation.operation !== 'create' &&
    mutation.baseVersion !== undefined &&
    currentVersion !== mutation.baseVersion
  ) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Entity version conflict',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const now = nowIso();

  if (mutation.entityType === 'project') {
    return applyProjectMutation(env, actorId, mutation, now, currentVersion);
  }

  let entityStmt: D1PreparedStatement;
  try {
    const built = await buildEntityStatement(
      env,
      table,
      mutation,
      now,
      currentVersion
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

  // Cross-project move detection (task/note/todo only). Read the entity's
  // current project; if the update targets a different one, the change log
  // needs rows in BOTH projects. See describeMoveFanOut.
  let existingProjectId: string | null = null;
  if (mutation.operation === 'update') {
    const jsonTable = jsonTableFor(mutation.entityType);
    if (jsonTable) {
      const row = await env.D1_DATABASE.prepare(
        `SELECT project_id FROM ${jsonTable} WHERE id = ? AND deleted_at IS NULL`
      )
        .bind(mutation.entityId)
        .first<{ project_id: string | null }>();
      existingProjectId = row?.project_id ?? null;
    }
  }
  const fanOut = describeMoveFanOut(
    mutation.entityType,
    mutation.operation,
    existingProjectId,
    mutation
  );

  try {
    await env.D1_DATABASE.batch([
      entityStmt,
      prepareIncrementVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId,
        now
      ),
      ...(fanOut
        ? fanOut.map((r) =>
            prepareInsertSyncChangeRow(
              env,
              actorId,
              mutation,
              r.projectId,
              r.operation,
              r.patch,
              now
            )
          )
        : [prepareInsertSyncChange(env, actorId, mutation, now)]),
    ]);
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

  return {};
}
