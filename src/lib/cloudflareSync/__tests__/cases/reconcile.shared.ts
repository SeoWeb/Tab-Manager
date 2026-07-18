import type { Collection, Link } from '@/types';
import type { Note } from '@/stores/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type {
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
} from '../../types';

export const PROJECT_ID = 'proj-1';

/** Build a local Collection. */
export function collection(
  id: string,
  updatedAt: Date,
  extra: Partial<Collection> = {}
): Collection {
  return {
    id,
    name: `coll-${id}`,
    description: undefined,
    links: [],
    createdAt: updatedAt,
    updatedAt,
    color: '#fff',
    minimized: false,
    order: 0,
    bookmarkFolderId: null,
    ...extra,
  };
}

/** Build a local Link (nested under a collection). */
export function link(
  id: string,
  collectionId: string,
  updatedAt: Date | undefined,
  extra: Partial<Link> = {}
): Link {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    favIconUrl: undefined,
    createdAt: updatedAt ?? new Date(0),
    updatedAt: updatedAt ?? new Date(0),
    tags: [],
    notes: undefined,
    order: 0,
    bookmarkId: null,
    ...extra,
  };
}

export function note(id: string, updatedAt: Date, extra: Partial<Note> = {}): Note {
  return {
    id,
    title: `note-${id}`,
    content: `content-${id}`,
    color: '#ffffff',
    createdAt: updatedAt,
    updatedAt,
    isPinned: false,
    projectId: PROJECT_ID,
    ...extra,
  };
}

export function task(
  id: string,
  updatedAt: Date,
  extra: Partial<AdvancedTask> = {}
): AdvancedTask {
  return {
    id,
    title: `task-${id}`,
    description: '',
    priority: 'medium',
    status: 'todo',
    category: 'general',
    tags: [],
    projectId: PROJECT_ID,
    subtasks: [],
    attachments: [],
    notes: '',
    createdAt: updatedAt,
    updatedAt,
    reminders: [],
    progress: 0,
    comments: [],
    activities: [],
    isArchived: false,
    isFavorite: false,
    customFields: {},
    ...extra,
  };
}

export function todo(id: string, extra: Partial<LegacyTask> = {}): LegacyTask {
  return {
    id,
    text: `todo-${id}`,
    completed: false,
    projectId: PROJECT_ID,
    ...extra,
  };
}

export function snapJson(
  id: string,
  updatedAt: string,
  payloadJson: string,
  opts: Partial<Omit<SnapshotJsonEntity, 'collection_id'>> = {}
): SnapshotJsonEntity {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: null,
    title: `title-${id}`,
    payload_json: payloadJson,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

export function snapLink(
  id: string,
  collectionId: string | null,
  updatedAt: string,
  opts: Partial<Omit<SnapshotLink, 'collection_id'>> = {}
): SnapshotLink {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: collectionId,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    fav_icon_url: null,
    notes: null,
    tags_json: null,
    order_index: null,
    bookmark_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

export function snapCollection(
  id: string,
  updatedAt: string,
  opts: Partial<Omit<SnapshotCollection, 'collection_id'>> = {}
): SnapshotCollection {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: null,
    name: `coll-${id}`,
    description: null,
    color: '#fff',
    minimized: 0,
    order_index: null,
    bookmark_folder_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

export function emptyServer(): SnapshotResponse {
  return { collections: [], links: [], tasks: [], notes: [], todos: [] };
}

export const T0 = new Date('2026-01-01T00:00:00.000Z');
export const T1 = new Date('2026-01-02T00:00:00.000Z');
export const T2 = new Date('2026-01-03T00:00:00.000Z');
