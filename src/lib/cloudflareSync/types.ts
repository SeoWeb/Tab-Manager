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
}
