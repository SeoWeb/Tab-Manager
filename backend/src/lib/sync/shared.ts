import type {
  EntityType,
  SyncConflict,
  SyncMutation,
  SyncOperation,
} from '../../types';

/**
 * Number of `?` placeholders inside the entity-count guard subquery. The guard
 * tallies one `SELECT COUNT(*) FROM <table> WHERE project_id = ?` per entity
 * table (collections, links, tasks, notes, todos), so each guarded insert must
 * bind the project id that many times before the `createCount`/`maxEntities`
 * args. Mismatched bindings make D1 throw at runtime.
 */
export const TABLE_COUNT_PLACEHOLDERS = 5;

export type TableKey =
  | 'projects'
  | 'collections'
  | 'links'
  | 'tasks'
  | 'notes'
  | 'todos';

export type ApplyMutationResult = {
  conflict?: SyncConflict;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function tableFor(entityType: EntityType): TableKey | null {
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
    default:
      return null;
  }
}

export function jsonTableFor(
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

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEntityType(value: unknown): value is EntityType {
  return (
    value === 'project' ||
    value === 'collection' ||
    value === 'link' ||
    value === 'task' ||
    value === 'note' ||
    value === 'todo'
  );
}

export function isSyncOperation(value: unknown): value is SyncOperation {
  return value === 'create' || value === 'update' || value === 'delete';
}

export function parseCursor(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isNumber(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function parseMutations(value: unknown): SyncMutation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidMutation);
}

export function isValidMutation(value: unknown): value is SyncMutation {
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

export function requireString(
  patch: Record<string, unknown>,
  key: string
): string {
  const value = patch[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function entityNotFoundConflict(
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
