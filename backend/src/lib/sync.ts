import { badRequest } from './response';
import {
  requireProjectAccess,
  getMembershipRole,
  requireMinRole,
} from './projects';
import { notifyRealtime } from './realtime';
import type {
  Env,
  EntityType,
  SyncChange,
  SyncConflict,
  SyncMutation,
  SyncOperation,
  SyncRequest,
  SyncResponse,
} from '../types';

type TableKey =
  | 'projects'
  | 'collections'
  | 'links'
  | 'tasks'
  | 'notes'
  | 'todos';

type ApplyMutationResult = {
  conflict?: SyncConflict;
};

function nowIso(): string {
  return new Date().toISOString();
}

function tableFor(entityType: EntityType): TableKey | null {
  switch (entityType) {
    case 'project':
      return 'projects';
    case 'collection':
      return 'collections';
    case 'link':
      return 'links';
    case 'task':
      return 'tasks';
    case 'note':
      return 'notes';
    case 'todo':
      return 'todos';
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCursor(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isNumber(value)) return null;
  return Math.max(0, Math.floor(value));
}

function parseMutations(value: unknown): SyncMutation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidMutation);
}

function isValidMutation(value: unknown): value is SyncMutation {
  if (!isObjectRecord(value)) return false;
  return (
    isString(value.clientMutationId) &&
    isString(value.projectId) &&
    isEntityType(value.entityType) &&
    isString(value.entityId) &&
    isSyncOperation(value.operation) &&
    isObjectRecord(value.patch) &&
    isString(value.clientId) &&
    isString(value.createdAt)
  );
}

function isEntityType(value: unknown): value is EntityType {
  return (
    value === 'project' ||
    value === 'collection' ||
    value === 'link' ||
    value === 'task' ||
    value === 'note' ||
    value === 'todo'
  );
}

function isSyncOperation(value: unknown): value is SyncOperation {
  return value === 'create' || value === 'update' || value === 'delete';
}

export async function syncProject(
  env: Env,
  user: { id: string },
  projectId: string,
  body: unknown
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'editor');
  if (access instanceof Response) return access;

  if (!isObjectRecord(body)) {
    return badRequest('Sync request body must be an object');
  }

  const request = body as SyncRequest;
  const lastCursor = parseCursor(request.lastCursor);
  const mutations = parseMutations(request.mutations);
  const conflicts: SyncConflict[] = [];

  // Capture the highest existing change id before applying, so we can fan out
  // only the rows this request inserts (Phase 5 realtime).
  const beforeCursor = await getMaxChangeId(env, projectId);

  for (const mutation of mutations) {
    if (mutation.projectId !== projectId) {
      conflicts.push({
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Mutation project id does not match sync project id',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      });
      continue;
    }

    const result = await applyMutation(env, user.id, mutation);
    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }

  const changes = await getChangesSince(env, projectId, lastCursor);
  const cursor = changes.at(-1)?.id ?? lastCursor ?? 0;

  // Push the changes committed by this request to any member currently viewing
  // the project over a realtime socket. Best-effort; never fails the sync.
  const inserted =
    beforeCursor === null
      ? changes
      : changes.filter((c) => c.id > beforeCursor);
  await notifyRealtime(env, projectId, inserted);

  const response: SyncResponse = {
    cursor,
    changes,
    conflicts,
  };

  return Response.json(response);
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

/**
 * Apply a single client mutation idempotently. The entity write, the per-entity
 * version bump, and the append-only sync_changes row are committed together in
 * one D1 batch so a failure can never leave the change log out of sync with the
 * entity state.
 */
async function applyMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation
): Promise<ApplyMutationResult> {
  const existingMutation = await env.D1_DATABASE.prepare(
    'SELECT id FROM sync_changes WHERE client_mutation_id = ?'
  )
    .bind(mutation.clientMutationId)
    .first<{ id: number }>();

  if (existingMutation) {
    return {};
  }

  const table = tableFor(mutation.entityType);
  if (!table) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Unsupported entity type',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const currentVersion = await getEntityVersion(
    env,
    mutation.projectId,
    mutation.entityType,
    mutation.entityId
  );
  if (
    mutation.operation !== 'create' &&
    mutation.baseVersion !== undefined &&
    currentVersion !== mutation.baseVersion
  ) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Entity version conflict',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const now = nowIso();

  if (mutation.entityType === 'project') {
    return applyProjectMutation(env, actorId, mutation, now, currentVersion);
  }

  let entityStmt: D1PreparedStatement;
  try {
    const built = await buildEntityStatement(
      env,
      table,
      mutation,
      now,
      currentVersion
    );
    if ('conflict' in built) return { conflict: built.conflict };
    entityStmt = built.stmt;
  } catch (error) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message:
          error instanceof Error ? error.message : 'Invalid mutation patch',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  // Cross-project move detection (task/note/todo only). Read the entity's
  // current project; if the update targets a different one, the change log
  // needs rows in BOTH projects. See describeMoveFanOut.
  let existingProjectId: string | null = null;
  if (mutation.operation === 'update') {
    const jsonTable = jsonTableFor(mutation.entityType);
    if (jsonTable) {
      const row = await env.D1_DATABASE.prepare(
        `SELECT project_id FROM ${jsonTable} WHERE id = ? AND deleted_at IS NULL`
      )
        .bind(mutation.entityId)
        .first<{ project_id: string | null }>();
      existingProjectId = row?.project_id ?? null;
    }
  }
  const fanOut = describeMoveFanOut(
    mutation.entityType,
    mutation.operation,
    existingProjectId,
    mutation
  );

  try {
    await env.D1_DATABASE.batch([
      entityStmt,
      prepareIncrementVersion(
        env,
        mutation.projectId,
        mutation.entityType,
        mutation.entityId,
        now
      ),
      ...(fanOut
        ? fanOut.map((r) =>
            prepareInsertSyncChangeRow(
              env,
              actorId,
              mutation,
              r.projectId,
              r.operation,
              r.patch,
              now
            )
          )
        : [prepareInsertSyncChange(env, actorId, mutation, now)]),
    ]);
  } catch (error) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message:
          error instanceof Error ? error.message : 'Invalid mutation patch',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  return {};
}

/**
 * Build the prepared statement that performs the entity write for a mutation.
 * Pure reads (existence checks, current-row merge) happen here; nothing is
 * committed until the caller runs the returned statement in a batch.
 */
async function buildEntityStatement(
  env: Env,
  table: TableKey,
  mutation: SyncMutation,
  now: string,
  currentVersion: number
): Promise<{ stmt: D1PreparedStatement } | { conflict: SyncConflict }> {
  switch (mutation.operation) {
    case 'delete': {
      const exists = await entityExists(env, table, mutation.entityId);
      if (!exists)
        return { conflict: entityNotFoundConflict(mutation, currentVersion) };
      return {
        stmt: env.D1_DATABASE.prepare(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).bind(now, now, mutation.entityId),
      };
    }
    case 'create': {
      if (await entityExists(env, table, mutation.entityId)) {
        return {
          conflict: {
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            clientMutationId: mutation.clientMutationId,
            message: 'Entity already exists',
            currentVersion,
            expectedVersion: mutation.baseVersion,
          },
        };
      }
      return { stmt: prepareInsert(env, mutation, now) };
    }
    case 'update':
    default: {
      const stmt = await prepareUpdate(env, mutation, now);
      if (!stmt)
        return { conflict: entityNotFoundConflict(mutation, currentVersion) };
      return { stmt };
    }
  }
}

async function applyProjectMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  now: string,
  currentVersion: number
): Promise<ApplyMutationResult> {
  if (mutation.operation === 'create') {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message:
          'Create projects through POST /projects instead of the sync endpoint',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  if (mutation.operation === 'delete') {
    const role = await getMembershipRole(env, actorId, mutation.projectId);
    if (!requireMinRole(role, 'admin')) {
      return {
        conflict: {
          entityType: 'project',
          entityId: mutation.entityId,
          clientMutationId: mutation.clientMutationId,
          message: 'Project deletion requires admin role or higher',
          currentVersion,
          expectedVersion: mutation.baseVersion,
        },
      };
    }
    await env.D1_DATABASE.batch([
      env.D1_DATABASE.prepare(
        'UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      ).bind(now, now, mutation.entityId),
      prepareIncrementVersion(
        env,
        mutation.projectId,
        'project',
        mutation.entityId,
        now
      ),
      prepareInsertSyncChange(env, actorId, mutation, now),
    ]);
    return {};
  }

  const existing = await env.D1_DATABASE.prepare(
    'SELECT name, description, color, icon FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(mutation.entityId)
    .first<{
      name: string;
      description: string | null;
      color: string | null;
      icon: string | null;
    }>();

  if (!existing) {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Project not found',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const name =
    mutation.patch.name === undefined ? existing.name : mutation.patch.name;
  if (typeof name !== 'string' || !name.trim()) {
    return {
      conflict: {
        entityType: 'project',
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Project name must be a non-empty string',
        currentVersion,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  const description =
    mutation.patch.description === undefined
      ? existing.description
      : optionalString(mutation.patch.description);
  const color =
    mutation.patch.color === undefined
      ? existing.color
      : optionalString(mutation.patch.color);
  const icon =
    mutation.patch.icon === undefined
      ? existing.icon
      : optionalString(mutation.patch.icon);

  await env.D1_DATABASE.batch([
    env.D1_DATABASE.prepare(
      'UPDATE projects SET name = ?, description = ?, color = ?, icon = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).bind(name, description, color, icon, now, mutation.entityId),
    prepareIncrementVersion(
      env,
      mutation.projectId,
      'project',
      mutation.entityId,
      now
    ),
    prepareInsertSyncChange(env, actorId, mutation, now),
  ]);

  return {};
}

function prepareInsert(
  env: Env,
  mutation: SyncMutation,
  now: string
): D1PreparedStatement {
  switch (mutation.entityType) {
    case 'collection':
      return prepareInsertCollection(env, mutation, now);
    case 'link':
      return prepareInsertLink(env, mutation, now);
    case 'task':
    case 'note':
    case 'todo':
      return prepareInsertJsonEntity(env, mutation, now);
    default:
      throw new Error('Unsupported entity type');
  }
}

async function prepareUpdate(
  env: Env,
  mutation: SyncMutation,
  now: string
): Promise<D1PreparedStatement | null> {
  switch (mutation.entityType) {
    case 'collection':
      return prepareUpdateCollection(env, mutation, now);
    case 'link':
      return prepareUpdateLink(env, mutation, now);
    case 'task':
    case 'note':
    case 'todo':
      return prepareUpdateJsonEntity(env, mutation, now);
    default:
      return null;
  }
}

function prepareInsertCollection(
  env: Env,
  mutation: SyncMutation,
  now: string
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

  return env.D1_DATABASE.prepare(
    `
    INSERT INTO collections (
      id, project_id, name, description, color, minimized, order_index,
      bookmark_folder_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    mutation.entityId,
    mutation.projectId,
    name,
    description,
    color,
    minimized,
    orderIndex,
    bookmarkFolderId,
    now,
    now
  );
}

async function prepareUpdateCollection(
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

function prepareInsertLink(
  env: Env,
  mutation: SyncMutation,
  now: string
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

  return env.D1_DATABASE.prepare(
    `
    INSERT INTO links (
      id, project_id, collection_id, url, title, fav_icon_url, notes,
      tags_json, order_index, bookmark_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
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
    now
  );
}

async function prepareUpdateLink(
  env: Env,
  mutation: SyncMutation,
  now: string
): Promise<D1PreparedStatement | null> {
  const existing = await env.D1_DATABASE.prepare(
    'SELECT collection_id, url, title, fav_icon_url, notes, tags_json, order_index, bookmark_id FROM links WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(mutation.entityId)
    .first<{
      collection_id: string | null;
      url: string;
      title: string | null;
      fav_icon_url: string | null;
      notes: string | null;
      tags_json: string | null;
      order_index: number | null;
      bookmark_id: string | null;
    }>();

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

  return env.D1_DATABASE.prepare(
    `
    UPDATE links
    SET collection_id = ?, url = ?, title = ?, fav_icon_url = ?, notes = ?,
        tags_json = ?, order_index = ?, bookmark_id = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
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
    mutation.entityId
  );
}

function prepareInsertJsonEntity(
  env: Env,
  mutation: SyncMutation,
  now: string
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

  return env.D1_DATABASE.prepare(
    `
    INSERT INTO ${table} (
      id, project_id, collection_id, title, payload_json, order_index, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    mutation.entityId,
    mutation.projectId,
    collectionId,
    title,
    payloadJson,
    orderIndex,
    now,
    now
  );
}

async function prepareUpdateJsonEntity(
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

async function entityExists(
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

async function getEntityVersion(
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

function prepareIncrementVersion(
  env: Env,
  projectId: string,
  entityType: EntityType,
  entityId: string,
  updatedAt: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO entity_versions (project_id, entity_type, entity_id, version, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(project_id, entity_type, entity_id) DO UPDATE SET
      version = version + 1,
      updated_at = excluded.updated_at
    `
  ).bind(projectId, entityType, entityId, updatedAt);
}

/**
 * Build a sync_changes INSERT for an arbitrary (projectId, operation, patch).
 * `prepareInsertSyncChange` (below) is the common case — one row mirroring the
 * mutation — while the move fan-out (see `describeMoveFanOut`) emits rows whose
 * project/operation/patch differ from the incoming mutation.
 */
function prepareInsertSyncChangeRow(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  projectId: string,
  operation: SyncOperation,
  patch: Record<string, unknown>,
  createdAt: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO sync_changes (
      change_id, project_id, actor_id, entity_type, entity_id, operation,
      patch_json, base_version, client_mutation_id, client_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    crypto.randomUUID(),
    projectId,
    actorId,
    mutation.entityType,
    mutation.entityId,
    operation,
    JSON.stringify(patch),
    mutation.baseVersion ?? null,
    mutation.clientMutationId,
    mutation.clientId,
    createdAt
  );
}

function prepareInsertSyncChange(
  env: Env,
  actorId: string,
  mutation: SyncMutation,
  createdAt: string
): D1PreparedStatement {
  return prepareInsertSyncChangeRow(
    env,
    actorId,
    mutation,
    mutation.projectId,
    mutation.operation,
    mutation.patch,
    createdAt
  );
}

function entityNotFoundConflict(
  mutation: SyncMutation,
  currentVersion: number
): SyncConflict {
  return {
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    clientMutationId: mutation.clientMutationId,
    message: 'Entity not found or already deleted',
    currentVersion,
    expectedVersion: mutation.baseVersion,
  };
}

function jsonTableFor(
  entityType: EntityType
): 'tasks' | 'notes' | 'todos' | null {
  switch (entityType) {
    case 'task':
      return 'tasks';
    case 'note':
      return 'notes';
    case 'todo':
      return 'todos';
    default:
      return null;
  }
}

export interface ChangeLogRow {
  projectId: string;
  operation: SyncOperation;
  patch: Record<string, unknown>;
}

/**
 * Decide whether a JSON-entity (task/note/todo) update is a cross-project move,
 * and if so, which change-log rows must be emitted. The change log is partitioned
 * by project_id, so a single update row can't reach members of both the old and
 * the new project: instead emit a 'create' row in the new project's log (so its
 * members materialize the entity) and a 'delete' row in the old project's log
 * (so its members drop it). Both rows inherit the acting mutation's client_id,
 * so the moving client skips them as echoes while everyone else applies them.
 *
 * Returns null for a non-move (the caller emits the normal single row). Pure —
 * unit-tested without a database.
 */
export function describeMoveFanOut(
  entityType: EntityType,
  operation: SyncOperation,
  existingProjectId: string | null,
  mutation: { projectId: string; patch: Record<string, unknown> }
): ChangeLogRow[] | null {
  if (operation !== 'update') return null;
  if (!jsonTableFor(entityType)) return null;
  if (!existingProjectId) return null;
  if (existingProjectId === mutation.projectId) return null;
  return [
    {
      projectId: mutation.projectId,
      operation: 'create',
      patch: mutation.patch,
    },
    { projectId: existingProjectId, operation: 'delete', patch: {} },
  ];
}

function requireString(patch: Record<string, unknown>, key: string): string {
  const value = patch[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
