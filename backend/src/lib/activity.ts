import { requireProjectAccess } from './membership';
import type { Env } from '../types';

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function getActivity(
  env: Env,
  user: { id: string },
  projectId: string,
  limit = 100
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId);
  if (access instanceof Response) return access;

  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const rows = await env.D1_DATABASE.prepare(
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
      sc.created_at,
      u.email AS actor_email,
      u.display_name AS actor_display_name
    FROM sync_changes sc
    LEFT JOIN users u ON u.id = sc.actor_id
    WHERE sc.project_id = ?
    ORDER BY sc.id DESC
    LIMIT ?
    `
  )
    .bind(projectId, safeLimit)
    .all();

  const changes = (rows.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    change_id: row.change_id,
    project_id: row.project_id,
    actor_id: row.actor_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    operation: row.operation,
    patch: safeJsonParse(row.patch_json as string | null),
    base_version: row.base_version,
    client_mutation_id: row.client_mutation_id,
    client_id: row.client_id,
    created_at: row.created_at,
    actor_email: (row.actor_email as string | null) ?? null,
    actor_display_name: (row.actor_display_name as string | null) ?? null,
  }));

  return Response.json({ changes });
}
