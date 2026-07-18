import type { Env, EntityType } from '../../types';
import type { TableKey } from './shared';

export async function entityExists(
  env: Env,
  table: TableKey,
  entityId: string
): Promise<boolean> {
  const row = await env.D1_DATABASE.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(entityId)
    .first<{ id: string }>();

  return Boolean(row);
}

export async function getEntityVersion(
  env: Env,
  projectId: string,
  entityType: EntityType,
  entityId: string
): Promise<number> {
  const row = await env.D1_DATABASE.prepare(
    'SELECT version FROM entity_versions WHERE project_id = ? AND entity_type = ? AND entity_id = ?'
  )
    .bind(projectId, entityType, entityId)
    .first<{ version: number }>();

  return row?.version ?? 0;
}

/**
 * Concurrently check existence for a set of (table, entityId) pairs. Each entry
 * hits a different table, so we fan out individual `first()` calls with
 * `Promise.all` instead of serializing them; this removes the N+1 read latency
 * from the create batching loop.
 */
export async function entityExistsBatch(
  env: Env,
  entries: { table: TableKey; entityId: string }[]
): Promise<boolean[]> {
  return Promise.all(
    entries.map(({ table, entityId }) => entityExists(env, table, entityId))
  );
}

/**
 * Concurrently fetch versions for a set of (projectId, entityType, entityId)
 * triples. Fanned out with `Promise.all` to avoid serializing the reads.
 */
export async function getEntityVersionBatch(
  env: Env,
  entries: { projectId: string; entityType: EntityType; entityId: string }[]
): Promise<number[]> {
  return Promise.all(
    entries.map(({ projectId, entityType, entityId }) =>
      getEntityVersion(env, projectId, entityType, entityId)
    )
  );
}
