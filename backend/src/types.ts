export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export type EntityType =
  | 'project'
  | 'collection'
  | 'link'
  | 'task'
  | 'note'
  | 'todo';

export type SyncOperation = 'create' | 'update' | 'delete';

/**
 * Minimal shape of the `send_email` binding so the Worker compiles without
 * pulling in the full `@cloudflare/workers-types` package. `send` returns the
 * message id Cloudflare assigned (used only for logging/debugging).
 */
export interface EmailSendResult {
  messageId?: string;
}

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface EmailBinding {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface Env {
  D1_DATABASE: D1Database;
  /**
   * Per-project realtime room (Phase 5). One Durable Object instance per
   * project id, obtained via `idForName(projectId)`.
   */
  PROJECT_ROOM: DurableObjectNamespace;
  /**
   * Per-key sliding-window rate limiter (this change). One Durable Object
   * instance per rate-limit key, obtained via `idForName(key)`.
   */
  RATE_LIMITER: DurableObjectNamespace;
  JWT_SECRET: string;
  ALLOWED_ORIGINS?: string;
  /**
   * Cloudflare `send_email` binding used to deliver the magic-PIN login email.
   */
  EMAIL: EmailBinding;

  // --- Rate-limit threshold overrides (all per-60s window) ---
  RATE_LIMIT_GLOBAL_PER_IP?: string;
  RATE_LIMIT_API_PER_USER?: string;
  RATE_LIMIT_SYNC_PER_USER?: string;
  RATE_LIMIT_AUTH_REQUEST?: string;
  RATE_LIMIT_AUTH_VERIFY?: string;

  // --- Usage-quota overrides ---
  QUOTA_MAX_PROJECTS_PER_USER?: string;
  QUOTA_MAX_MEMBERS_PER_PROJECT?: string;
  QUOTA_MAX_ENTITIES_PER_PROJECT?: string;
  QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST?: string;

  /**
   * Snapshot pagination page cap per entity type (scale-sync-backend).
   * Default 500; parsed values are clamped to 1..2000. The request's
   * `pageSize` param may lower the cap, never raise it.
   */
  SNAPSHOT_PAGE_SIZE?: string;
  /**
   * Sync kill-switch (scale-sync-backend). `SYNC_SERIAL_MODE=1` forces the
   * whole sync engine through the pre-batching serial apply path (per-create
   * two-phase commit + per-mutation `applyMutation`). Any other value or unset
   * uses the batched apply path. Rollback story: set `SYNC_SERIAL_MODE=1` in
   * the deployment env to restore the exact pre-batching behavior.
   */
  SYNC_SERIAL_MODE?: string;

  // --- Changelog pruning overrides (scale-sync-backend) ---
  /**
   * Retention window in days for `sync_changes` rows; older rows are pruned
   * by the daily changelog cron. Default 90.
   */
  CHANGELOG_RETENTION_DAYS?: string;
  /**
   * Per-project change-log row cap; the oldest overflow is pruned. Default
   * 50000.
   */
  CHANGELOG_MAX_ROWS_PER_PROJECT?: string;
  /**
   * Rows deleted per DELETE statement during pruning (SQLite/D1 has no
   * reliable `DELETE ... LIMIT`, so batches are bounded id subselects).
   * Default 500.
   */
  CHANGELOG_PRUNE_BATCH_ROWS?: string;
  /**
   * Total statements (DELETEs + bookkeeping SELECTs) one pruning run may
   * spend before stopping cleanly until the next run. Default 40.
   */
  CHANGELOG_PRUNE_MAX_STATEMENTS?: string;
  /**
   * Set to "1" to make the pruning run execute only its reads and log what
   * would be deleted, deleting nothing.
   */
  CHANGELOG_PRUNE_DRY_RUN?: string;

  // --- Access-token lifetime (harden-auth-tokens) ---
  /**
   * Lifetime in seconds for newly minted access tokens. Default 604800
   * (7 days); parsed values are clamped to 60..2592000 (1 minute..30 days).
   */
  TOKEN_TTL_SECONDS?: string;
  /**
   * Migration cutover flag (harden-auth-tokens). Set to "1" after one legacy
   * token lifetime (~30 days post-deploy) to reject exp-less tokens as
   * unauthenticated. Unset (default) keeps exp-less legacy tokens valid.
   */
  REQUIRE_EXP_ON_ALL_TOKENS?: string;
}

export interface JwtPayload {
  sub: string;
  email?: string;
  display_name?: string | null;
  iat?: number;
  exp?: number;
  /**
   * Unique token id (harden-auth-tokens). Minted on every new token so a
   * future revocation story needs no format change. Only ever logged hashed.
   */
  jti?: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  updated_at: string;
  email: string;
  display_name: string | null;
}

export interface CollectionRecord {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string | null;
  minimized: number;
  order_index: number | null;
  bookmark_folder_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LinkRecord {
  id: string;
  project_id: string;
  collection_id: string | null;
  url: string;
  title: string | null;
  fav_icon_url: string | null;
  notes: string | null;
  tags_json: string | null;
  order_index: number | null;
  bookmark_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface JsonEntityRecord {
  id: string;
  project_id: string;
  collection_id: string | null;
  title: string | null;
  payload_json: string;
  order_index: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SyncMutation {
  clientMutationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
  operation: SyncOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
  clientId: string;
  createdAt: string;
}

export interface SyncChange {
  id: number;
  change_id: string;
  project_id: string;
  actor_id: string;
  entity_type: EntityType;
  entity_id: string;
  operation: SyncOperation;
  patch: unknown;
  base_version: number | null;
  client_mutation_id: string | null;
  client_id: string | null;
  created_at: string;
  actor_email?: string | null;
  actor_display_name?: string | null;
}

export interface SyncConflict {
  entityType: EntityType;
  entityId: string;
  clientMutationId: string;
  message: string;
  currentVersion: number;
  expectedVersion?: number;
}

export interface SyncRequest {
  lastCursor?: number | null;
  mutations?: SyncMutation[];
}

/**
 * Terminal state of one submitted sync mutation. Exactly one outcome entry is
 * produced per submitted mutation (positionally aligned with the request).
 *
 * - `applied`  — committed (including replays already present in the change log,
 *                which are an idempotent success per migration 0004).
 * - `conflict` — deterministic rejection that the client should reconcile
 *                (version conflict, entity not found, invalid patch, ...).
 * - `skipped`  — not attempted at all; `reason` is machine-readable.
 * - `error`    — reserved for per-mutation non-infrastructure failures;
 *                infrastructure failures THROW to the top-level 500 handler
 *                and never appear here.
 */
export type SyncMutationOutcomeStatus = 'applied' | 'conflict' | 'skipped' | 'error';

export type SyncMutationSkipReason =
  | 'missing_base_version'
  | 'project_mismatch'
  | 'invalid_mutation';

export interface SyncMutationOutcome {
  clientMutationId: string;
  status: SyncMutationOutcomeStatus;
  /** Fixed, client-safe message. Only present for `conflict`. */
  message?: string;
  /** Machine-readable reason. Only present for `skipped`. */
  reason?: SyncMutationSkipReason;
}

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  /**
   * Legacy top-level conflict list, still populated for backwards compatibility
   * with the current extension consumer. New consumers should read `outcomes`.
   */
  conflicts: SyncConflict[];
  /** Exactly one entry per submitted mutation, in submission order. */
  outcomes: SyncMutationOutcome[];
  /**
   * Lagging-client flag (scale-sync-backend, change-log-retention). Present and
   * true ONLY when the request's incremental cursor predates the project's
   * pruned change-log window (`project_sync_meta.max_pruned_change_id`): the
   * delta since that cursor would be incomplete, so `changes` is empty by
   * design and the client must converge via the snapshot endpoint instead.
   * Absent entirely on healthy incremental responses.
   */
  reconcileRequired?: boolean;
}

export interface SnapshotCollection {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string | null;
  minimized: number;
  order_index: number | null;
  bookmark_folder_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

export interface SnapshotLink {
  id: string;
  project_id: string;
  collection_id: string | null;
  url: string;
  title: string | null;
  fav_icon_url: string | null;
  notes: string | null;
  tags_json: string | null;
  order_index: number | null;
  bookmark_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

export interface SnapshotJsonEntity {
  id: string;
  project_id: string;
  collection_id: string | null;
  title: string | null;
  payload_json: string;
  order_index: number | null;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

/**
 * The five snapshot entity types, named exactly like the top-level snapshot
 * response arrays. This is the identifier baked into an opaque snapshot cursor
 * and used as the keys of `SnapshotResponse.nextCursor`.
 */
export type SnapshotEntityTypeName =
  | 'collections'
  | 'links'
  | 'tasks'
  | 'notes'
  | 'todos';

/**
 * Per-type continuation cursors on a paginated snapshot response. Each value
 * is an opaque cursor the client echoes back as `?cursor=` to fetch the next
 * page *for that type*. A type's entry is present only when that type has more
 * rows past its current page; the whole map is omitted when none does.
 */
export interface SnapshotNextCursors {
  collections?: string;
  links?: string;
  tasks?: string;
  notes?: string;
  todos?: string;
}

/** Optional pagination controls accepted by `getProjectSnapshot`. */
export interface SnapshotPaginationParams {
  /** Opaque continuation cursor taken from a previous `nextCursor` value. */
  cursor?: string | null;
  /**
   * Requested page size (the route passes the raw `?pageSize=` string).
   * May lower the configured page cap, never raise it.
   */
  pageSize?: number | string | null;
}

export interface SnapshotResponse {
  collections: SnapshotCollection[];
  links: SnapshotLink[];
  tasks: SnapshotJsonEntity[];
  notes: SnapshotJsonEntity[];
  todos: SnapshotJsonEntity[];
  /**
   * Additive (scale-sync-backend): present only when at least one entity type
   * has more rows past its page. A request carrying `?cursor=` returns ONLY
   * the cursored type populated (the other four arrays are empty) and at most
   * that type's entry here. Old clients ignore the unknown field.
   */
  nextCursor?: SnapshotNextCursors;
}
