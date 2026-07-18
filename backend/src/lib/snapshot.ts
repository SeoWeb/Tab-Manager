import type {
  Env,
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
} from '../types';

/**
 * Returns the project's *current* entity set (collections, links, tasks, notes,
 * todos) for reconciliation. Includes soft-deleted rows (`deleted_at IS NOT
 * NULL`) so the client can locally delete entities the server has removed, and
 * attaches the `entity_versions.version` to each row so last-write-wins ties
 * can be broken precisely. Reads existing tables only — no schema migration.
 */
export async function getProjectSnapshot(
  env: Env,
  projectId: string
): Promise<SnapshotResponse> {
  const collections = await fetchSnapshotTable<SnapshotCollection>(
    env,
    projectId,
    'collections',
    'collection',
    [
      'id',
      'project_id',
      'name',
      'description',
      'color',
      'minimized',
      'order_index',
      'bookmark_folder_id',
      'updated_at',
      'deleted_at',
    ]
  );

  const links = await fetchSnapshotTable<SnapshotLink>(
    env,
    projectId,
    'links',
    'link',
    [
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
      'updated_at',
      'deleted_at',
    ]
  );

  const tasks = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'tasks',
    'task',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  const notes = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'notes',
    'note',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  const todos = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'todos',
    'todo',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  return { collections, links, tasks, notes, todos };
}

/**
 * Reads every row (live and soft-deleted) of a single entity table for the
 * project, LEFT JOINing `entity_versions` to attach each row's `version`
 * (defaulting to 1 when no version row exists yet).
 */
async function fetchSnapshotTable<T>(
  env: Env,
  projectId: string,
  table: string,
  entityType: string,
  columns: string[]
): Promise<T[]> {
  const colList = columns.map((c) => `t.${c}`).join(', ');
  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT ${colList}, COALESCE(ev.version, 1) AS version
    FROM ${table} t
    LEFT JOIN entity_versions ev
      ON ev.project_id = t.project_id
      AND ev.entity_type = ?
      AND ev.entity_id = t.id
    WHERE t.project_id = ?
    `
  )
    .bind(entityType, projectId)
    .all<T>();

  return rows.results ?? [];
}
