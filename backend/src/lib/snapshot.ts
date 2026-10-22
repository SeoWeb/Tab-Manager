import type {
  Env,
  SnapshotCollection,
  SnapshotEntityTypeName,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotNextCursors,
  SnapshotPaginationParams,
  SnapshotResponse,
} from '../types';

/**
 * Snapshot reads for reconciliation, with per-type cursor pagination
 * (scale-sync-backend).
 *
 * Wire contract (pinned for the extension client):
 * - `?cursor=<opaque>&pageSize=<int>`, both optional.
 * - The cursor is base64url of `{"t":<type>,"u":<updated_at>,"i":<id>}` and is
 *   opaque to clients (encoding/decoding lives here).
 * - WITHOUT `cursor`: page 1 of all five types — arrays exactly as before —
 *   plus an additive `nextCursor` map with an entry per type that has more
 *   rows. Old clients ignore the unknown field; projects under the page cap
 *   get no `nextCursor` at all.
 * - WITH `cursor`: ONLY the named type carries rows (its next page); the other
 *   four arrays are empty and `nextCursor` holds at most that type's entry.
 * - Ordering is `ORDER BY updated_at ASC, id ASC`; the next page is the rows
 *   strictly after `(updated_at, id)` of the page's last row — pure keyset, so
 *   a cursor row deleted between pages needs no lookup: the scan resumes from
 *   the strict comparison regardless.
 * - `pageSize` may lower the configured cap (`SNAPSHOT_PAGE_SIZE`, default
 *   500, clamped to 1..2000), never raise it.
 * - An undecodable/unknown cursor throws `InvalidSnapshotCursorError`, which
 *   the route maps to a 400 whose fixed message hints at a full reconcile.
 */

export const DEFAULT_SNAPSHOT_PAGE_SIZE = 500;
export const MIN_SNAPSHOT_PAGE_SIZE = 1;
export const MAX_SNAPSHOT_PAGE_SIZE = 2000;

/**
 * Thrown when a request's snapshot cursor cannot be decoded or names an
 * unknown entity type. The route turns this into a fixed-message 400 that
 * never echoes the (untrusted) cursor value back.
 */
export class InvalidSnapshotCursorError extends Error {
  constructor() {
    super('Invalid snapshot cursor');
    this.name = 'InvalidSnapshotCursorError';
  }
}

const SNAPSHOT_ENTITY_TYPES: readonly SnapshotEntityTypeName[] = [
  'collections',
  'links',
  'tasks',
  'notes',
  'todos',
];

function isSnapshotEntityType(value: unknown): value is SnapshotEntityTypeName {
  return (
    typeof value === 'string' &&
    (SNAPSHOT_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

// --- Opaque cursor codec (server-side only) ---------------------------------

interface SnapshotCursorPayload {
  /** Snapshot entity type (one of the five response array keys). */
  t: SnapshotEntityTypeName;
  /** `updated_at` of the last row of the previous page. */
  u: string;
  /** `id` of the last row of the previous page. */
  i: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded); // throws on invalid base64 → rejected cursor
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Fatal mode: garbage that decodes to invalid UTF-8 is rejected as-is
  // instead of being silently replaced with U+FFFD.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
    bytes
  );
}

/**
 * Build the opaque continuation cursor for a type's next page. Call with the
 * last row of the page being served.
 */
export function encodeSnapshotCursor(
  entityType: SnapshotEntityTypeName,
  updatedAt: string,
  id: string
): string {
  const payload: SnapshotCursorPayload = { t: entityType, u: updatedAt, i: id };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a client-supplied cursor. Returns null for anything that is not
 * exactly a cursor for one of the five snapshot types (bad base64, non-JSON,
 * unknown type, missing fields).
 */
export function decodeSnapshotCursor(
  cursor: string
): SnapshotCursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(cursor));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const { t, u, i } = parsed as Record<string, unknown>;
    if (
      !isSnapshotEntityType(t) ||
      typeof u !== 'string' ||
      typeof i !== 'string'
    ) {
      return null;
    }
    return { t, u, i };
  } catch {
    return null;
  }
}

// --- Page-size resolution ---------------------------------------------------

function parsePageSize(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : Number.NaN;
}

/**
 * Effective page size: the env cap (`SNAPSHOT_PAGE_SIZE`, default 500,
 * clamped to 1..2000), optionally lowered by the request's `pageSize` param.
 * An invalid or absent request value leaves the cap untouched; a request can
 * never raise the cap.
 */
export function resolveSnapshotPageSize(
  env: Env,
  requested?: number | string | null
): number {
  const capRaw = parsePageSize(env.SNAPSHOT_PAGE_SIZE);
  const cap = Number.isFinite(capRaw)
    ? Math.min(Math.max(capRaw, MIN_SNAPSHOT_PAGE_SIZE), MAX_SNAPSHOT_PAGE_SIZE)
    : DEFAULT_SNAPSHOT_PAGE_SIZE;
  const wanted = parsePageSize(requested ?? null);
  if (!Number.isFinite(wanted) || wanted < MIN_SNAPSHOT_PAGE_SIZE) return cap;
  return Math.min(wanted, cap);
}

// --- Table specs (column lists unchanged from the unbounded reader) ---------

interface SnapshotTableSpec {
  table: string;
  /** The `entity_versions.entity_type` discriminator for this table. */
  entityType: string;
  columns: string[];
}

const SNAPSHOT_TABLES: Record<SnapshotEntityTypeName, SnapshotTableSpec> = {
  collections: {
    table: 'collections',
    entityType: 'collection',
    columns: [
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
    ],
  },
  links: {
    table: 'links',
    entityType: 'link',
    columns: [
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
    ],
  },
  tasks: {
    table: 'tasks',
    entityType: 'task',
    columns: [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ],
  },
  notes: {
    table: 'notes',
    entityType: 'note',
    columns: [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ],
  },
  todos: {
    table: 'todos',
    entityType: 'todo',
    columns: [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ],
  },
};

type AnySnapshotRow = SnapshotCollection | SnapshotLink | SnapshotJsonEntity;

/**
 * Returns the project's *current* entity set (collections, links, tasks,
 * notes, todos) for reconciliation. Includes soft-deleted rows (`deleted_at
 * IS NOT NULL`) so the client can locally delete entities the server has
 * removed, and attaches the `entity_versions.version` to each row so
 * last-write-wins ties can be broken precisely. Reads existing tables only —
 * no schema migration.
 *
 * With `pagination.cursor` set, only that type's next page is populated (the
 * other four arrays come back empty); otherwise page 1 of every type is
 * returned, plus `nextCursor` entries for types with more rows. Iterating the
 * cursors yields exactly the rows an unbounded fetch would return.
 */
export async function getProjectSnapshot(
  env: Env,
  projectId: string,
  pagination?: SnapshotPaginationParams
): Promise<SnapshotResponse> {
  const pageSize = resolveSnapshotPageSize(env, pagination?.pageSize);
  const rawCursor = pagination?.cursor;

  if (rawCursor) {
    const cursor = decodeSnapshotCursor(rawCursor);
    if (!cursor) throw new InvalidSnapshotCursorError();

    const page = await fetchSnapshotPage<AnySnapshotRow>(
      env,
      projectId,
      cursor.t,
      pageSize,
      { updatedAt: cursor.u, id: cursor.i }
    );
    return snapshotWithPage(cursor.t, page);
  }

  // No cursor: page 1 of every type (backward-compatible shape — the arrays
  // are exactly what old clients saw, plus the additive `nextCursor` map).
  const collections = await fetchSnapshotPage<SnapshotCollection>(
    env,
    projectId,
    'collections',
    pageSize
  );
  const links = await fetchSnapshotPage<SnapshotLink>(
    env,
    projectId,
    'links',
    pageSize
  );
  const tasks = await fetchSnapshotPage<SnapshotJsonEntity>(
    env,
    projectId,
    'tasks',
    pageSize
  );
  const notes = await fetchSnapshotPage<SnapshotJsonEntity>(
    env,
    projectId,
    'notes',
    pageSize
  );
  const todos = await fetchSnapshotPage<SnapshotJsonEntity>(
    env,
    projectId,
    'todos',
    pageSize
  );

  const nextCursors: SnapshotNextCursors = {};
  if (collections.nextCursor) nextCursors.collections = collections.nextCursor;
  if (links.nextCursor) nextCursors.links = links.nextCursor;
  if (tasks.nextCursor) nextCursors.tasks = tasks.nextCursor;
  if (notes.nextCursor) nextCursors.notes = notes.nextCursor;
  if (todos.nextCursor) nextCursors.todos = todos.nextCursor;

  const response: SnapshotResponse = {
    collections: collections.rows,
    links: links.rows,
    tasks: tasks.rows,
    notes: notes.rows,
    todos: todos.rows,
  };
  if (Object.keys(nextCursors).length > 0) {
    response.nextCursor = nextCursors;
  }
  return response;
}

interface SnapshotPage<T> {
  /** At most `pageSize` rows, ordered by (updated_at, id) ASC. */
  rows: T[];
  /** Present only when more rows follow this page. */
  nextCursor?: string;
}

/**
 * Read one ordered page of a single entity table. Fetches `pageSize + 1` rows
 * so "are there more?" is a length check; the extra row never reaches the
 * caller. `after` is the strict keyset continuation point — the cursor row
 * itself does not need to exist anymore.
 */
async function fetchSnapshotPage<T extends AnySnapshotRow>(
  env: Env,
  projectId: string,
  type: SnapshotEntityTypeName,
  pageSize: number,
  after?: { updatedAt: string; id: string }
): Promise<SnapshotPage<T>> {
  const rows = await fetchSnapshotTable<T>(env, projectId, type, {
    after,
    limit: pageSize + 1,
  });
  if (rows.length > pageSize) {
    const last = rows[pageSize - 1];
    return {
      rows: rows.slice(0, pageSize),
      nextCursor: encodeSnapshotCursor(type, last.updated_at, last.id),
    };
  }
  return { rows };
}

/** Cursor-mode response: only the named type carries rows. */
function snapshotWithPage(
  type: SnapshotEntityTypeName,
  page: SnapshotPage<AnySnapshotRow>
): SnapshotResponse {
  const response: SnapshotResponse = {
    collections: [],
    links: [],
    tasks: [],
    notes: [],
    todos: [],
  };
  if (type === 'collections') {
    response.collections = page.rows as SnapshotCollection[];
  } else if (type === 'links') {
    response.links = page.rows as SnapshotLink[];
  } else if (type === 'tasks') {
    response.tasks = page.rows as SnapshotJsonEntity[];
  } else if (type === 'notes') {
    response.notes = page.rows as SnapshotJsonEntity[];
  } else {
    response.todos = page.rows as SnapshotJsonEntity[];
  }
  if (page.nextCursor) {
    response.nextCursor = { [type]: page.nextCursor };
  }
  return response;
}

interface FetchPageOptions {
  /** Keyset continuation: rows strictly after (updatedAt, id). */
  after?: { updatedAt: string; id: string };
  /** Max rows to return (callers pass pageSize+1 to detect has-more). */
  limit: number;
}

/**
 * Reads one bounded, ordered page (live and soft-deleted rows) of a single
 * entity table for the project, LEFT JOINing `entity_versions` to attach each
 * row's `version` (defaulting to 1 when no version row exists yet). Stable
 * order is `updated_at ASC, id ASC`; with `after`, only rows strictly after
 * that `(updated_at, id)` pair are returned — no row lookup, so a cursor row
 * deleted mid-iteration still resumes correctly.
 */
async function fetchSnapshotTable<T>(
  env: Env,
  projectId: string,
  type: SnapshotEntityTypeName,
  options: FetchPageOptions
): Promise<T[]> {
  const spec = SNAPSHOT_TABLES[type];
  const colList = spec.columns.map((c) => `t.${c}`).join(', ');
  const keyset = options.after
    ? `
      AND (t.updated_at > ? OR (t.updated_at = ? AND t.id > ?))`
    : '';
  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT ${colList}, COALESCE(ev.version, 1) AS version
    FROM ${spec.table} t
    LEFT JOIN entity_versions ev
      ON ev.project_id = t.project_id
      AND ev.entity_type = ?
      AND ev.entity_id = t.id
    WHERE t.project_id = ?${keyset}
    ORDER BY t.updated_at ASC, t.id ASC
    LIMIT ?
    `
  )
    .bind(
      ...(options.after
        ? [
            spec.entityType,
            projectId,
            options.after.updatedAt,
            options.after.updatedAt,
            options.after.id,
          ]
        : [spec.entityType, projectId]),
      options.limit
    )
    .all<T>();

  return rows.results ?? [];
}
