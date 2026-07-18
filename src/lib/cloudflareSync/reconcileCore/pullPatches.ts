import type { LegacyTask } from '@/types/tasks';
import type {
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
} from '../types';
import { parseTags } from './types';

function collectionPullPatch(row: SnapshotCollection): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    color: row.color,
    minimized: row.minimized === 1,
    order: row.order_index,
    bookmarkFolderId: row.bookmark_folder_id,
    updated_at: row.updated_at,
  };
}

function linkPullPatch(row: SnapshotLink): Record<string, unknown> {
  return {
    collectionId: row.collection_id,
    url: row.url,
    title: row.title,
    favIconUrl: row.fav_icon_url,
    notes: row.notes,
    tags: parseTags(row.tags_json),
    order: row.order_index,
    bookmarkId: row.bookmark_id,
    updated_at: row.updated_at,
  };
}

/**
 * Notes/todos/tasks are stored server-side as a `title` plus a `payload_json`
 * blob. The pull patch reproduces exactly that wire shape (plus `updated_at` and
 * `collectionId` for tasks) so `applyRemoteChanges` reconstructs them verbatim.
 */
function jsonPullPatch(row: SnapshotJsonEntity): Record<string, unknown> {
  let payload: Record<string, unknown> = {};
  if (row.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (parsed && typeof parsed === 'object')
        payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  const patch: Record<string, unknown> = {
    title: row.title,
    payload,
    updated_at: row.updated_at,
  };
  if (row.collection_id) patch.collectionId = row.collection_id;
  return patch;
}

function todoEqualsServer(local: LegacyTask, row: SnapshotJsonEntity): boolean {
  let payload: Record<string, unknown> = {};
  if (row.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (parsed && typeof parsed === 'object')
        payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  const serverText =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.title === 'string'
        ? payload.title
        : '';
  const serverCompleted = payload.completed === true;
  const serverCategory =
    typeof payload.category === 'string' ? payload.category : null;
  return (
    local.text === serverText &&
    local.completed === serverCompleted &&
    (local.category ?? null) === serverCategory
  );
}

export { collectionPullPatch, linkPullPatch, jsonPullPatch, todoEqualsServer };
