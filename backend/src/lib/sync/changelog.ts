import type { Env, EntityType, SyncChange, SyncOperation } from '../../types';

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Highest change-log id for a project, or null if none exist yet. */
export async function getMaxChangeId(
  env: Env,
  projectId: string
): Promise<number | null> {
  const row = await env.D1_DATABASE.prepare(
    'SELECT MAX(id) AS max_id FROM sync_changes WHERE project_id = ?'
  )
    .bind(projectId)
    .first<{ max_id: number | null }>();
  return row?.max_id ?? null;
}

/**
 * The most recent change-log row for a project (used by project CRUD handlers to
 * fan out meta changes/deletes over realtime). Returns null if none exist.
 */
export async function getLatestChange(
  env: Env,
  projectId: string
): Promise<SyncChange | null> {
  const row = await env.D1_DATABASE.prepare(
    `
    SELECT
      sc.id, sc.change_id, sc.project_id, sc.actor_id, sc.entity_type,
      sc.entity_id, sc.operation, sc.patch_json, sc.base_version,
      sc.client_mutation_id, sc.client_id, sc.created_at
    FROM sync_changes sc
    WHERE sc.project_id = ?
    ORDER BY sc.id DESC
    LIMIT 1
    `
  )
    .bind(projectId)
    .first<Record<string, unknown>>();

  if (!row) return null;
  return {
    id: row.id as number,
    change_id: row.change_id as string,
    project_id: row.project_id as string,
    actor_id: row.actor_id as string,
    entity_type: row.entity_type as EntityType,
    entity_id: row.entity_id as string,
    operation: row.operation as SyncOperation,
    patch: safeJsonParse(row.patch_json as string | null),
    base_version: (row.base_version as number | null) ?? null,
    client_mutation_id: (row.client_mutation_id as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

export async function getChangesSince(
  env: Env,
  projectId: string,
  cursor: number | null
): Promise<SyncChange[]> {
  const result = await env.D1_DATABASE.prepare(
    `
    SELECT
      sc.id,
      sc.change_id,
      sc.project_id,
      sc.actor_id,
      sc.entity_type,
      sc.entity_id,
      sc.operation,
      sc.patch_json,
      sc.base_version,
      sc.client_mutation_id,
      sc.client_id,
      sc.created_at
    FROM sync_changes sc
    WHERE sc.project_id = ? AND (? IS NULL OR sc.id > ?)
    ORDER BY sc.id ASC
    LIMIT 1000
    `
  )
    .bind(projectId, cursor, cursor)
    .all();

  return (result.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    change_id: row.change_id as string,
    project_id: row.project_id as string,
    actor_id: row.actor_id as string,
    entity_type: row.entity_type as EntityType,
    entity_id: row.entity_id as string,
    operation: row.operation as SyncOperation,
    patch: safeJsonParse(row.patch_json as string | null),
    base_version: row.base_version as number | null,
    client_mutation_id: row.client_mutation_id as string | null,
    client_id: row.client_id as string | null,
    created_at: row.created_at as string,
  }));
}
