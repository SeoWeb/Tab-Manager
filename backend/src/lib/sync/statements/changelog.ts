import type { Env, EntityType, SyncMutation, SyncOperation } from '../../../types';

export function prepareIncrementVersion(
  env: Env,
  projectId: string,
  entityType: EntityType,
  entityId: string,
  updatedAt: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO entity_versions (project_id, entity_type, entity_id, version, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(project_id, entity_type, entity_id) DO UPDATE SET
      version = version + 1,
      updated_at = excluded.updated_at
    `
  ).bind(projectId, entityType, entityId, updatedAt);
}

/**
 * Build a sync_changes INSERT for an arbitrary (projectId, operation, patch).
 * `prepareInsertSyncChange` (below) is the common case — one row mirroring the
 * mutation — while the move fan-out (see `describeMoveFanOut`) emits rows whose
 * project/operation/patch differ from the incoming mutation.
 */
export function prepareInsertSyncChangeRow(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  projectId: string,
  operation: SyncOperation,
  patch: Record<string, unknown>,
  createdAt: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO sync_changes (
      change_id, project_id, actor_id, entity_type, entity_id, operation,
      patch_json, base_version, client_mutation_id, client_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    crypto.randomUUID(),
    projectId,
    actorId,
    mutation.entityType,
    mutation.entityId,
    operation,
    JSON.stringify(patch),
    mutation.baseVersion ?? null,
    mutation.clientMutationId,
    mutation.clientId,
    createdAt
  );
}

export function prepareInsertSyncChange(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  createdAt: string
): D1PreparedStatement {
  return prepareInsertSyncChangeRow(
    env,
    actorId,
    mutation,
    mutation.projectId,
    mutation.operation,
    mutation.patch,
    createdAt
  );
}
