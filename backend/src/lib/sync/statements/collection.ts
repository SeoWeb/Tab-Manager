import type { Env, SyncMutation } from '../../../types';
import {
  TABLE_COUNT_PLACEHOLDERS,
  VERSION_GUARD_SQL,
  optionalNumber,
  optionalString,
  requireString,
  versionGuardBindings,
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

/**
 * Shape of the current-row read feeding the collection update merge.
 */
export interface CollectionRow {
  name: string;
  description: string | null;
  color: string | null;
  minimized: number;
  order_index: number | null;
  bookmark_folder_id: string | null;
}

/**
 * Project-scoped current-row read for the update merge. Exported so the
 * batched apply path can fan one read per mutation through a single shared D1
 * batch instead of a round-trip per mutation.
 */
export function prepareReadCollectionRow(
  env: Env,
  mutation: SyncMutation,
  projectId: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    'SELECT name, description, color, minimized, order_index, bookmark_folder_id FROM collections WHERE id = ? AND project_id = ? AND deleted_at IS NULL'
  ).bind(mutation.entityId, projectId);
}

/**
 * Build the CAS-guarded (or legacy unguarded) collection UPDATE from an
 * already-read row. Project-scoped; `project_id` never in the SET list.
 * Returns null when `existing` is null (row gone — caller maps to the
 * not-found conflict).
 */
export function buildCollectionUpdateStatement(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion: number | undefined,
  existing: CollectionRow | null
): D1PreparedStatement | null {
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

  const guardSql = baseVersion === undefined ? '' : ` ${VERSION_GUARD_SQL}`;
  return env.D1_DATABASE.prepare(
    `
    UPDATE collections
    SET name = ?, description = ?, color = ?, minimized = ?, order_index = ?,
        bookmark_folder_id = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL${guardSql}
    `
  ).bind(
    name,
    description,
    color,
    minimized,
    orderIndex,
    bookmarkFolderId,
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
export async function prepareUpdateCollection(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion?: number
): Promise<D1PreparedStatement | null> {
  const existing = await prepareReadCollectionRow(
    env,
    mutation,
    projectId
  ).first<CollectionRow>();

  return buildCollectionUpdateStatement(
    env,
    mutation,
    projectId,
    now,
    baseVersion,
    existing
  );
}
