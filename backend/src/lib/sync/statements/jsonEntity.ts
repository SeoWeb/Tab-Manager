import type { Env, SyncMutation } from '../../../types';
import {
  TABLE_COUNT_PLACEHOLDERS,
  MutationPatchError,
  VERSION_GUARD_SQL,
  jsonTableFor,
  optionalNumber,
  optionalString,
  versionGuardBindings,
} from '../shared';

export function prepareInsertJsonEntity(
  env: Env,
  mutation: SyncMutation,
  now: string,
  guardSql?: string,
  guardArgs?: unknown[]
): D1PreparedStatement {
  const title = optionalString(mutation.patch.title);
  const payloadJson = mutation.patch.payload
    ? JSON.stringify(mutation.patch.payload)
    : null;
  const orderIndex = optionalNumber(
    mutation.patch.order ?? mutation.patch.orderIndex
  );
  const collectionId = optionalString(mutation.patch.collectionId);

  const table = jsonTableFor(mutation.entityType);
  if (!table) throw new MutationPatchError('Unsupported entity type');

  const cols = [
    'id',
    'project_id',
    'collection_id',
    'title',
    'payload_json',
    'order_index',
    'created_at',
    'updated_at',
  ];
  const values = [
    mutation.entityId,
    mutation.projectId,
    collectionId,
    title,
    payloadJson,
    orderIndex,
    now,
    now,
  ];

  const sql = guardSql
    ? `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols
        .map(() => '?')
        .join(', ')} WHERE (${guardSql})`
    : `INSERT INTO ${table} (${cols.join(
        ', '
      )}) VALUES (${cols.map(() => '?').join(', ')})`;

  // The guard subquery references the project id once per table (collections,
  // links, tasks, notes, todos); bind it for each placeholder plus the
  // `createCount`/`maxEntities` args, otherwise D1 throws a binding mismatch.
  const bound =
    guardSql && guardArgs
      ? [
          ...values,
          ...Array(TABLE_COUNT_PLACEHOLDERS).fill(mutation.projectId),
          ...guardArgs,
        ]
      : [...values, ...(guardArgs ?? [])];
  return env.D1_DATABASE.prepare(sql).bind(...bound);
}

/**
 * Shape of the current-row read feeding the JSON-entity update merge. The
 * batched apply path materializes these rows through a shared pre-batch read
 * (see `prepareReadJsonEntityRow`), so the merge itself is pure.
 */
export interface JsonEntityRow {
  collection_id: string | null;
  title: string | null;
  payload_json: string | null;
  order_index: number | null;
}

/**
 * Project-scoped current-row read for the update merge. Exported so the
 * batched apply path can fan one read per mutation through a single shared D1
 * batch instead of a round-trip per mutation.
 */
export function prepareReadJsonEntityRow(
  env: Env,
  mutation: SyncMutation,
  projectId: string
): D1PreparedStatement {
  const table = jsonTableFor(mutation.entityType);
  if (!table) throw new MutationPatchError('Unsupported entity type');
  return env.D1_DATABASE.prepare(
    `SELECT collection_id, title, payload_json, order_index FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).bind(mutation.entityId, projectId);
}

/**
 * Build the CAS-guarded (or legacy unguarded, when `baseVersion` is undefined)
 * entity UPDATE for a JSON entity from an already-read row.
 *
 * Security invariants:
 * - the write is scoped to `projectId` — a caller can never update a row owned
 *   by another project;
 * - `project_id` is NEVER part of the SET list — an update cannot move an
 *   entity across projects;
 * - when `baseVersion` is supplied the write only commits while the entity's
 *   version still equals it (compare-and-swap).
 *
 * Returns null when `existing` is null (row gone between read and build — the
 * caller maps that to the not-found conflict, like the serial path).
 */
export function buildJsonEntityUpdateStatement(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion: number | undefined,
  existing: JsonEntityRow | null
): D1PreparedStatement | null {
  const table = jsonTableFor(mutation.entityType);
  if (!table) return null;
  if (!existing) return null;

  const collectionId =
    mutation.patch.collectionId === undefined
      ? existing.collection_id
      : optionalString(mutation.patch.collectionId);
  const title =
    mutation.patch.title === undefined
      ? existing.title
      : optionalString(mutation.patch.title);
  const payloadJson =
    mutation.patch.payload === undefined
      ? existing.payload_json
      : JSON.stringify(mutation.patch.payload);
  const orderIndex =
    mutation.patch.order === undefined &&
    mutation.patch.orderIndex === undefined
      ? existing.order_index
      : optionalNumber(mutation.patch.order ?? mutation.patch.orderIndex);

  const guardSql =
    baseVersion === undefined ? '' : ` ${VERSION_GUARD_SQL}`;
  return env.D1_DATABASE.prepare(
    `
    UPDATE ${table}
    SET collection_id = ?, title = ?, payload_json = ?, order_index = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL${guardSql}
    `
  ).bind(
    collectionId,
    title,
    payloadJson,
    orderIndex,
    now,
    mutation.entityId,
    projectId,
    ...(baseVersion === undefined
      ? []
      : versionGuardBindings(projectId, mutation.entityType, mutation.entityId, baseVersion))
  );
}

/**
 * Serial path: read the row, then merge + build (see the two functions above).
 */
export async function prepareUpdateJsonEntity(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion?: number
): Promise<D1PreparedStatement | null> {
  const existing = await prepareReadJsonEntityRow(
    env,
    mutation,
    projectId
  ).first<JsonEntityRow>();

  return buildJsonEntityUpdateStatement(
    env,
    mutation,
    projectId,
    now,
    baseVersion,
    existing
  );
}
