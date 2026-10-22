import type { Env, SyncMutation } from '../../../types';
import {
  TABLE_COUNT_PLACEHOLDERS,
  VERSION_GUARD_SQL,
  optionalNumber,
  optionalString,
  requireString,
  versionGuardBindings,
} from '../shared';

export function prepareInsertLink(
  env: Env,
  mutation: SyncMutation,
  now: string,
  guardSql?: string,
  guardArgs?: unknown[]
): D1PreparedStatement {
  const url = requireString(mutation.patch, 'url');
  const title = optionalString(mutation.patch.title);
  const favIconUrl = optionalString(
    mutation.patch.favIconUrl ?? mutation.patch.faviconUrl
  );
  const notes = optionalString(mutation.patch.notes);
  const tagsJson = mutation.patch.tags
    ? JSON.stringify(mutation.patch.tags)
    : null;
  const orderIndex = optionalNumber(
    mutation.patch.order ?? mutation.patch.orderIndex
  );
  const bookmarkId = optionalString(mutation.patch.bookmarkId);

  const cols = [
    'id',
    'project_id',
    'collection_id',
    'url',
    'title',
    'fav_icon_url',
    'notes',
    'tags_json',
    'order_index',
    'bookmark_id',
    'created_at',
    'updated_at',
  ];
  const values = [
    mutation.entityId,
    mutation.projectId,
    optionalString(mutation.patch.collectionId),
    url,
    title,
    favIconUrl,
    notes,
    tagsJson,
    orderIndex,
    bookmarkId,
    now,
    now,
  ];

  const sql = guardSql
    ? `INSERT INTO links (${cols.join(', ')}) SELECT ${cols
        .map(() => '?')
        .join(', ')} WHERE (${guardSql})`
    : `INSERT INTO links (${cols.join(', ')}) VALUES (${cols
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
 * Shape of the current-row read feeding the link update merge.
 */
export interface LinkRow {
  collection_id: string | null;
  url: string;
  title: string | null;
  fav_icon_url: string | null;
  notes: string | null;
  tags_json: string | null;
  order_index: number | null;
  bookmark_id: string | null;
}

/**
 * Project-scoped current-row read for the update merge. Exported so the
 * batched apply path can fan one read per mutation through a single shared D1
 * batch instead of a round-trip per mutation.
 */
export function prepareReadLinkRow(
  env: Env,
  mutation: SyncMutation,
  projectId: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    'SELECT collection_id, url, title, fav_icon_url, notes, tags_json, order_index, bookmark_id FROM links WHERE id = ? AND project_id = ? AND deleted_at IS NULL'
  ).bind(mutation.entityId, projectId);
}

/**
 * Build the CAS-guarded (or legacy unguarded) link UPDATE from an already-read
 * row. Project-scoped; `project_id` never in the SET list. Returns null when
 * `existing` is null (row gone — caller maps to the not-found conflict).
 */
export function buildLinkUpdateStatement(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion: number | undefined,
  existing: LinkRow | null
): D1PreparedStatement | null {
  if (!existing) return null;

  const collectionId =
    mutation.patch.collectionId === undefined
      ? existing.collection_id
      : optionalString(mutation.patch.collectionId);
  const url =
    mutation.patch.url === undefined
      ? existing.url
      : requireString(mutation.patch, 'url');
  const title =
    mutation.patch.title === undefined
      ? existing.title
      : optionalString(mutation.patch.title);
  const favIconUrl =
    mutation.patch.favIconUrl === undefined &&
    mutation.patch.faviconUrl === undefined
      ? existing.fav_icon_url
      : optionalString(mutation.patch.favIconUrl ?? mutation.patch.faviconUrl);
  const notes =
    mutation.patch.notes === undefined
      ? existing.notes
      : optionalString(mutation.patch.notes);
  const tagsJson =
    mutation.patch.tags === undefined
      ? existing.tags_json
      : JSON.stringify(mutation.patch.tags);
  const orderIndex =
    mutation.patch.order === undefined &&
    mutation.patch.orderIndex === undefined
      ? existing.order_index
      : optionalNumber(mutation.patch.order ?? mutation.patch.orderIndex);
  const bookmarkId =
    mutation.patch.bookmarkId === undefined
      ? existing.bookmark_id
      : optionalString(mutation.patch.bookmarkId);

  const guardSql = baseVersion === undefined ? '' : ` ${VERSION_GUARD_SQL}`;
  return env.D1_DATABASE.prepare(
    `
    UPDATE links
    SET collection_id = ?, url = ?, title = ?, fav_icon_url = ?, notes = ?,
        tags_json = ?, order_index = ?, bookmark_id = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL${guardSql}
    `
  ).bind(
    collectionId,
    url,
    title,
    favIconUrl,
    notes,
    tagsJson,
    orderIndex,
    bookmarkId,
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
export async function prepareUpdateLink(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion?: number
): Promise<D1PreparedStatement | null> {
  const existing = await prepareReadLinkRow(
    env,
    mutation,
    projectId
  ).first<LinkRow>();

  return buildLinkUpdateStatement(
    env,
    mutation,
    projectId,
    now,
    baseVersion,
    existing
  );
}
