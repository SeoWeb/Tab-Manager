export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export type EntityType =
  | 'project'
  | 'collection'
  | 'link'
  | 'task'
  | 'note'
  | 'todo';

export type SyncOperation = 'create' | 'update' | 'delete';

export interface Env {
  D1_DATABASE: D1Database;
  /**
   * Per-project realtime room (Phase 5). One Durable Object instance per
   * project id, obtained via `idForName(projectId)`.
   */
  PROJECT_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ENABLE_DEMO_AUTH?: string;
  ALLOWED_ORIGINS?: string;
}

export interface JwtPayload {
  sub: string;
  email?: string;
  display_name?: string | null;
  iat?: number;
  exp?: number;
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

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  conflicts: SyncConflict[];
}
