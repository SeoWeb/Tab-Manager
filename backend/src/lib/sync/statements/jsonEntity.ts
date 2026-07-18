import type { Env, SyncMutation } from '../../../types';
import {
  TABLE_COUNT_PLACEHOLDERS,
  jsonTableFor,
  optionalNumber,
  optionalString,
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
  if (!table) throw new Error('Unsupported entity type');

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

export async function prepareUpdateJsonEntity(
  env: Env,
  mutation: SyncMutation,
  now: string
): Promise<D1PreparedStatement | null> {
  const table = jsonTableFor(mutation.entityType);
  if (!table) return null;

  const existing = await env.D1_DATABASE.prepare(
    `SELECT collection_id, title, payload_json, order_index FROM ${table} WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(mutation.entityId)
    .first<{
      collection_id: string | null;
      title: string | null;
      payload_json: string | null;
      order_index: number | null;
    }>();

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

  return env.D1_DATABASE.prepare(
    `
    UPDATE ${table}
    SET project_id = ?, collection_id = ?, title = ?, payload_json = ?, order_index = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
    `
  ).bind(
    mutation.projectId,
    collectionId,
    title,
    payloadJson,
    orderIndex,
    now,
    mutation.entityId
  );
}
