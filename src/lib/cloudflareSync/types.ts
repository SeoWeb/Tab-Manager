// Extension-side types for the Cloudflare sync client.
//
// These mirror the backend API contract in `backend/src/types.ts` but are owned
// by the extension so it never imports server code. Kept deliberately close to
// the wire format to make the sync request/response easy to follow.

export type CloudEntityType =
  | 'project'
  | 'collection'
  | 'link'
  | 'task'
  | 'note'
  | 'todo';

export type CloudOperation = 'create' | 'update' | 'delete';

/**
 * Project membership roles. Rank ordering matters for client-side enforcement
 * (see `roles.ts`): viewer < editor < admin < owner. The backend is the source
 * of truth — these powers only affect what the UI offers, never what it allows.
 */
export type CloudRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Coarse-grained sync status surfaced to the UI. */
export type CloudSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'error'
  | 'conflict';

/**
 * A member currently connected to a project's realtime room (Phase 5). Used for
 * presence display; the backend remains the source of truth for membership.
 */
export interface CloudPresenceUser {
  userId: string;
  displayName: string;
  role: CloudRole;
  /**
   * The entity + field this member is currently editing, if any. Drives the
   * soft-lock UI so collaborators can see (and avoid clobbering) each other's
   * in-progress edits. Absent when the member is not editing a field.
   */
  editing?: { entityId: string; field: string } | null;
}

/** A local mutation waiting to be pushed to the server. */
export interface CloudMutation {
  clientMutationId: string;
  projectId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
  clientId: string;
  createdAt: string;
}

/** One row from the server's append-only change log. */
export interface CloudSyncChange {
  id: number;
  change_id: string;
  project_id: string;
  actor_id: string;
  entity_type: CloudEntityType;
  entity_id: string;
  operation: CloudOperation;
  patch: unknown;
  base_version: number | null;
  client_mutation_id: string | null;
  client_id: string | null;
  created_at: string;
  /** Actor identity, joined from the users table by `getActivity`. */
  actor_email?: string | null;
  actor_display_name?: string | null;
}

/** A server-reported conflict for one of our mutations. */
export interface CloudSyncConflict {
  entityType: CloudEntityType;
  entityId: string;
  clientMutationId: string;
  message: string;
  currentVersion: number;
  expectedVersion?: number;
}

/**
 * A field-level conflict detected locally when a remote change arrives that
 * would overwrite a field we have a *pending, not-yet-pushed* edit for. Instead
 * of silently dropping the local edit (last-write-wins), we keep the local value
 * and surface this so the user can pick local / remote / merge.
 */
export interface SyncConflictItem {
  /** Stable id: `${entityId}:${field}:${changeId}`. */
  id: string;
  entityType: CloudEntityType;
  entityId: string;
  /** Entity field name (e.g. `title`, `description`, `status`, `content`). */
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  projectId: string;
  createdAt: string;
}

export type SyncConflictResolution = 'local' | 'remote' | 'merge';

/**
 * Field names a local client currently has pending (enqueued but not yet
 * acknowledged by the server) edits for, keyed by entity id. Used to detect
 * when an incoming remote change would clobber an unsynced local edit.
 */
export type DirtyFields = Record<string, string[]>;

/** Response shape of `POST /projects/:projectId/sync`. */
export interface CloudSyncResponse {
  cursor: number;
  changes: CloudSyncChange[];
  conflicts: CloudSyncConflict[];
}

/**
 * Response shape of `GET /projects/:projectId`. Includes the requesting user's
 * role in this project (Phase 4) so the extension can enforce it client-side.
 */
export interface CloudProjectDetail {
  project: CloudProject;
  role: CloudRole;
}

/** A project membership row, joined with the user's email/display name. */
export interface CloudMember {
  id: string;
  project_id: string;
  user_id: string;
  role: CloudRole;
  created_at: string;
  updated_at: string;
  email: string;
  display_name: string | null;
}

/** Response of `GET /projects/:projectId/members`. */
export interface CloudMembersResponse {
  members: CloudMember[];
}

/** Response of `POST /projects/:projectId/invitations` (the invite code). */
export interface CloudInvitation {
  id: string;
  code: string;
  project_id: string;
  email: string | null;
  role: CloudRole;
  expires_at: string;
  created_at: string;
}

/**
 * Response of `POST /invitations/:code/accept`. `role` is the role the user now
 * holds in the project; `accepted`/`already_member` distinguish the two paths.
 */
export interface CloudAcceptedInvitation {
  project_id: string;
  role: CloudRole;
  accepted?: boolean;
  already_member?: boolean;
}

/** Response of `PATCH /projects/:projectId/members/:userId`. */
export interface CloudMemberRoleUpdate {
  project_id: string;
  user_id: string;
  role: CloudRole;
}

/** Response of `DELETE /projects/:projectId/members/:userId`. */
export interface CloudMemberRemoval {
  project_id: string;
  user_id: string;
  removed: boolean;
}

/** Response of `GET /projects/:projectId/activity` (reuses the change log row). */
export interface CloudActivityResponse {
  changes: CloudSyncChange[];
}

/**
 * A single entity row in a project snapshot from `GET /projects/:id/snapshot`.
 * Every entity carries `updated_at`, `deleted_at`, and `version` so the client
 * can run last-write-wins comparison and detect server-side soft deletes.
 */
export interface SnapshotEntity {
  id: string;
  project_id: string;
  collection_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

/** A collection row in a project snapshot. */
export interface SnapshotCollection extends SnapshotEntity {
  name: string;
  description: string | null;
  color: string | null;
  minimized: number;
  order_index: number | null;
  bookmark_folder_id: string | null;
}

/** A link row in a project snapshot. */
export interface SnapshotLink extends SnapshotEntity {
  url: string;
  title: string | null;
  fav_icon_url: string | null;
  notes: string | null;
  tags_json: string | null;
  order_index: number | null;
  bookmark_id: string | null;
}

/** A note/todo/task row in a project snapshot (stored as title + payload_json). */
export interface SnapshotJsonEntity extends SnapshotEntity {
  title: string | null;
  payload_json: string;
}

/** Response shape of `GET /projects/:id/snapshot`. */
export interface SnapshotResponse {
  collections: SnapshotCollection[];
  links: SnapshotLink[];
  tasks: SnapshotJsonEntity[];
  notes: SnapshotJsonEntity[];
  todos: SnapshotJsonEntity[];
}

/** Non-secret account info mirrored into the Zustand store for the UI. */
export interface CloudAccount {
  id: string;
  email: string;
  displayName: string | null;
}

/** Project shape returned by `GET/POST /projects`. */
export interface CloudProject {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  /**
   * The requesting user's role in this project. Populated by `GET /projects`
   * (which joins `project_members`) but not by `POST /projects`, hence optional.
   */
  role?: CloudRole;
}

/** Response of `POST /auth/demo`. */
export interface CloudDemoAuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    display_name: string | null;
  };
}

/** The persisted slice of cloud-sync state held in the Zustand store. */
export interface CloudSyncState {
  enabled: boolean;
  status: CloudSyncStatus;
  lastSyncedAt: string | null;
  /** Last time a full reconciliation completed for any project (30-min cadence). */
  lastReconciledAt: string | null;
  lastError: string | null;
  pendingMutationCount: number;
  account: CloudAccount | null;
  apiBaseUrl: string;
  /** Per-project change-log cursors, keyed by project id. */
  cursors: Record<string, number>;
  /** Whether the realtime WebSocket for the active project is open (Phase 5). */
  realtimeConnected: boolean;
  /** Members currently connected to the active project's realtime room. */
  onlinePresence: CloudPresenceUser[];
  /**
   * Field names this client has pending (enqueued but not-yet-acknowledged)
   * edits for, keyed by entity id. Drives conflict detection when remote
   * changes arrive. Rebuilt from the mutation queue after every enqueue/sync.
   */
  pendingEdits: DirtyFields;
}
