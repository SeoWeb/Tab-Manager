import type { Collection } from '@/types';
import type { Note } from '@/stores/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type {
  CloudEntityType,
  CloudOperation,
  CloudSyncChange,
} from '../types';

/** Local entities for a single project, as held by the store. */
export interface DiffSnapshotLocal {
  collections: Collection[];
  tasks: AdvancedTask[];
  notes: Note[];
  todos: LegacyTask[];
}

/** A local-newer / local-only entity to enqueue as a cloud mutation. */
export interface PushItem {
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
}

export interface DiffSnapshotResult {
  /** Synthetic change rows (client_id: null) to apply via applyRemoteChanges. */
  pulls: CloudSyncChange[];
  /** Local-newer / local-only entities to enqueue as mutations. */
  pushes: PushItem[];
}

/** The minimal shape every snapshot row shares. */
export interface ServerRow {
  id: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SnapshotRow = ServerRow & { version: number };

export type Lww = 'server' | 'local' | 'equal';

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed))
      return parsed.filter((t) => typeof t === 'string');
  } catch {
    // leave empty
  }
  return [];
}
