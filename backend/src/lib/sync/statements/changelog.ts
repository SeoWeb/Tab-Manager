import type { Env, EntityType, SyncMutation, SyncOperation } from '../../../types';

/**
 * Legacy/create version bump: insert the version row at 1 or increment
 * unconditionally. Used for CREATE mutations (which start a fresh version
 * history) and for the legacy unguarded path of deletes issued without a
 * `baseVersion`. Update/delete CAS paths use `prepareCasIncrementVersion`.
 */
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
 * Compare-and-swap version bump: only increments while the stored version
 * still equals `expectedVersion`. Runs INSIDE the apply batch (D1 batch
 * statements execute sequentially in one transaction); a 0-changes result is
 * the authoritative conflict signal — the surrounding statements carry the
 * same guard, so nothing commits on a lost race.
 */
export function prepareCasIncrementVersion(
  env: Env,
  projectId: string,
  entityType: EntityType,
  entityId: string,
  updatedAt: string,
  expectedVersion: number
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    UPDATE entity_versions
    SET version = version + 1, updated_at = ?
    WHERE project_id = ? AND entity_type = ? AND entity_id = ? AND version = ?
    `
  ).bind(updatedAt, projectId, entityType, entityId, expectedVersion);
}

/**
 * Version read that runs INSIDE the apply batch (statement 0). It observes the
 * pre-write version within the same transaction, so a CAS failure can report
 * the authoritative `currentVersion` without a second round trip.
 */
export function prepareReadEntityVersion(
  env: Env,
  projectId: string,
  entityType: EntityType,
  entityId: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    'SELECT version FROM entity_versions WHERE project_id = ? AND entity_type = ? AND entity_id = ?'
  ).bind(projectId, entityType, entityId);
}

/**
 * Recognize the UNIQUE-violation raised by the (project_id, client_mutation_id)
 * unique index on sync_changes (migration 0004). A replay that raced past the
 * pre-check is an idempotent SUCCESS ("already applied"), not an error.
 */
export function isUniqueMutationIdViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('sync_changes')
  );
}

/**
 * Build a sync_changes INSERT for an arbitrary (projectId, operation, patch).
 * `prepareInsertSyncChange` (below) is the common case — one row mirroring the
 * mutation — while the move fan-out (see `describeMoveFanOut`) emits rows whose
 * project/operation/patch differ from the incoming mutation.
 *
 * When `guard` is supplied the insert is version-guarded: it only commits while
 * the entity's version still equals `guard.version`. This keeps the change log
 * atomic with the CAS-guarded entity write — a lost race writes NOTHING.
 */
export function prepareInsertSyncChangeRow(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  projectId: string,
  operation: SyncOperation,
  patch: Record<string, unknown>,
  createdAt: string,
  guard?: {
    projectId: string;
    entityType: EntityType;
    entityId: string;
    version: number;
  }
): D1PreparedStatement {
  if (guard) {
    return env.D1_DATABASE.prepare(
      `
      INSERT INTO sync_changes (
        change_id, project_id, actor_id, entity_type, entity_id, operation,
        patch_json, base_version, client_mutation_id, client_id, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT version FROM entity_versions WHERE project_id = ? AND entity_type = ? AND entity_id = ?) = ?
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
      createdAt,
      guard.projectId,
      guard.entityType,
      guard.entityId,
      guard.version
    );
  }

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
  createdAt: string,
  guard?: {
    projectId: string;
    entityType: EntityType;
    entityId: string;
    version: number;
  }
): D1PreparedStatement {
  return prepareInsertSyncChangeRow(
    env,
    actorId,
    mutation,
    mutation.projectId,
    mutation.operation,
    mutation.patch,
    createdAt,
    guard
  );
}
