import type { Env, EntityType } from '../../types';
import type { TableKey } from './shared';

/**
 * Prepared project-scoped live-row existence read — the statement behind
 * `entityExists`. Exported so applyMutation can batch it with the idempotency
 * dedupe read in a single D1 round-trip (per-statement results arrive in
 * order); `entityExists` keeps using it for the standalone `.first()` path.
 */
export function prepareEntityExistsStatement(
  env: Env,
  table: TableKey,
  entityId: string,
  projectId: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).bind(entityId, projectId);
}

/**
 * Prepared idempotency dedupe read — the migration-0004 replay pre-check
 * (UNIQUE(project_id, client_mutation_id) on sync_changes). Scoped to the
 * mutation's project: the same client mutation id in a DIFFERENT project is a
 * distinct mutation. Exported so the serial `applyMutation` fold and the
 * batched apply path issue byte-identical SQL.
 */
export function prepareMutationDedupeStatement(
  env: Env,
  mutation: { projectId: string; clientMutationId: string }
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    'SELECT id FROM sync_changes WHERE project_id = ? AND client_mutation_id = ?'
  ).bind(mutation.projectId, mutation.clientMutationId);
}

/**
 * Live-row existence check, SCOPED TO THE PROJECT. Every entity read in the
 * sync engine filters on `project_id` so a caller authorized for project A can
 * never even observe — let alone mutate — an entity that lives in project B.
 * A foreign id is indistinguishable from a nonexistent one.
 */
export async function entityExists(
  env: Env,
  table: TableKey,
  entityId: string,
  projectId: string
): Promise<boolean> {
  const row = await prepareEntityExistsStatement(
    env,
    table,
    entityId,
    projectId
  ).first<{ id: string }>();

  return Boolean(row);
}

/**
 * Current version of an entity WITHIN a project. A miss (entity not in this
 * project, or no version row) yields 0 — never a usable version for an entity
 * the caller cannot see.
 */
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
 * Concurrently check existence for a set of (projectId, table, entityId)
 * triples. Each entry hits a different table, so we fan out individual
 * `first()` calls with `Promise.all` instead of serializing them; this removes
 * the N+1 read latency from the create batching loop.
 */
export async function entityExistsBatch(
  env: Env,
  entries: { table: TableKey; entityId: string; projectId: string }[]
): Promise<boolean[]> {
  return Promise.all(
    entries.map(({ table, entityId, projectId }) =>
      entityExists(env, table, entityId, projectId)
    )
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
