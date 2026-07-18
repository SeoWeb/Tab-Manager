import type { Env, SyncOperation } from '../types';

export function prepareInsertSyncChange(
  env: Env,
  input: {
    projectId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    operation: SyncOperation;
    patch: Record<string, unknown>;
    clientMutationId: string | null;
    clientId: string | null;
    createdAt: string;
  }
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
    input.projectId,
    input.actorId,
    input.entityType,
    input.entityId,
    input.operation,
    JSON.stringify(input.patch),
    null,
    input.clientMutationId,
    input.clientId,
    input.createdAt
  );
}

export function prepareIncrementVersion(
  env: Env,
  projectId: string,
  entityType: string,
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
