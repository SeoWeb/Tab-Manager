import type { Env, SyncMutation } from '../../../types';
import {
  TABLE_COUNT_PLACEHOLDERS,
  optionalNumber,
  optionalString,
  requireString,
} from '../shared';

export function prepareInsertCollection(
  env: Env,
  mutation: SyncMutation,
  now: string,
  guardSql?: string,
  guardArgs?: unknown[]
): D1PreparedStatement {
  const name = requireString(mutation.patch, 'name');
  const description = optionalString(mutation.patch.description);
  const color = optionalString(mutation.patch.color);
  const minimized =
    mutation.patch.minimized === undefined
      ? 0
      : mutation.patch.minimized === true
        ? 1
        : 0;
  const orderIndex = optionalNumber(
    mutation.patch.order ?? mutation.patch.orderIndex
  );
  const bookmarkFolderId = optionalString(mutation.patch.bookmarkFolderId);

  const cols = [
    'id',
    'project_id',
    'name',
    'description',
    'color',
    'minimized',
    'order_index',
    'bookmark_folder_id',
    'created_at',
    'updated_at',
  ];
  const values = [
    mutation.entityId,
    mutation.projectId,
    name,
    description,
    color,
    minimized,
    orderIndex,
    bookmarkFolderId,
    now,
    now,
  ];

  // When a guard is supplied the insert only commits when the project is still
  // under its entity cap, making the create atomic with the quota check.
  const sql = guardSql
    ? `INSERT INTO collections (${cols.join(', ')}) SELECT ${cols
        .map(() => '?')
        .join(', ')} WHERE (${guardSql})`
    : `INSERT INTO collections (${cols.join(', ')}) VALUES (${cols
        .map(() => '?')
        .join(', ')})`;

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

export async function prepareUpdateCollection(
  env: Env,
  mutation: SyncMutation,
  now: string
): Promise<D1PreparedStatement | null> {
  const existing = await env.D1_DATABASE.prepare(
    'SELECT name, description, color, minimized, order_index, bookmark_folder_id FROM collections WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(mutation.entityId)
    .first<{
      name: string;
      description: string | null;
      color: string | null;
      minimized: number;
      order_index: number | null;
      bookmark_folder_id: string | null;
    }>();

  if (!existing) return null;

  const name =
    mutation.patch.name === undefined
      ? existing.name
      : requireString(mutation.patch, 'name');
  const description =
    mutation.patch.description === undefined
      ? existing.description
      : optionalString(mutation.patch.description);
  const color =
    mutation.patch.color === undefined
      ? existing.color
      : optionalString(mutation.patch.color);
  const minimized =
    mutation.patch.minimized === undefined
      ? existing.minimized
      : mutation.patch.minimized === true
        ? 1
        : 0;
  const orderIndex =
    mutation.patch.order === undefined &&
    mutation.patch.orderIndex === undefined
      ? existing.order_index
      : optionalNumber(mutation.patch.order ?? mutation.patch.orderIndex);
  const bookmarkFolderId =
    mutation.patch.bookmarkFolderId === undefined
      ? existing.bookmark_folder_id
      : optionalString(mutation.patch.bookmarkFolderId);

  return env.D1_DATABASE.prepare(
    `
    UPDATE collections
    SET name = ?, description = ?, color = ?, minimized = ?, order_index = ?,
        bookmark_folder_id = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
    `
  ).bind(
    name,
    description,
    color,
    minimized,
    orderIndex,
    bookmarkFolderId,
    now,
    mutation.entityId
  );
}
