import type { CloudSyncChange, DirtyFields, SyncConflictItem } from './types';
import type { ApplyChangesInput, ApplyContext } from './apply/shared';
import { applyProject } from './apply/projects';
import { applyCollection } from './apply/collections';
import { applyLink } from './apply/links';
import { applyNote } from './apply/notes';
import { applyTodo } from './apply/todos';
import { applyTask } from './apply/tasks';

/**
 * Pure reducer that folds server change-log rows into the local store shape.
 *
 * Remote changes arrive as flat `CloudSyncChange` rows; the local store is
 * nested (Project -> Collection[] -> Link[]) plus flat arrays for notes/todos/
 * tasks. This maps one onto the other, skipping changes that originated on this
 * client (the local store already reflects those, so re-applying the echo would
 * be redundant and could clobber optimistic state).
 *
 * The patch payload contract for notes/todos/tasks (the `payload` object) is
 * intentionally permissive: Phase 3 will tighten exactly which fields round-trip,
 * but this applier already maps the common fields defensively.
 */

export interface ApplyChangesResult extends ApplyChangesInput {
  /** Changes that mutated local state. */
  applied: number;
  /** Own echoes plus changes that referenced unknown entities. */
  skipped: number;
  /** Field-level conflicts where a remote change would clobber a pending local edit. */
  conflicts: SyncConflictItem[];
}

export function applyRemoteChanges(
  input: ApplyChangesInput,
  changes: CloudSyncChange[],
  clientId: string,
  dirtyFields: DirtyFields = {}
): ApplyChangesResult {
  // Deep-clone so we never mutate the live store arrays/dates.
  const state = structuredClone(input) as ApplyChangesInput;
  let applied = 0;
  let skipped = 0;
  const conflicts: SyncConflictItem[] = [];
  const ctx: ApplyContext = { dirtyFields, conflicts };

  for (const change of changes) {
    // Skip our own echoes for update/delete operations: local state already
    // reflects them (or holds newer optimistic edits we must not clobber).
    //
    // We deliberately DO apply our own `create` echoes. A `create` is safe to
    // re-apply — the builders de-dupe by entity id, so an entity we already
    // hold is left untouched and one we are missing is materialized. Skipping a
    // create echo would permanently drop a row the server keeps, which happens
    // whenever a *different tab* (or a post-wipe reload) performs the sync
    // while sharing this client id: that tab never held the entity locally, yet
    // the echo gets skipped as "ours". See the multi-tab / local-wipe desync.
    if (
      change.client_id &&
      change.client_id === clientId &&
      change.operation !== 'create'
    ) {
      skipped += 1;
      continue;
    }

    if (applyChange(state, change, ctx)) {
      applied += 1;
    } else {
      skipped += 1;
    }
  }

  return { ...state, applied, skipped, conflicts };
}

function applyChange(
  state: ApplyChangesInput,
  change: CloudSyncChange,
  ctx: ApplyContext
): boolean {
  switch (change.entity_type) {
    case 'project':
      return applyProject(state, change);
    case 'collection':
      return applyCollection(state, change);
    case 'link':
      return applyLink(state, change);
    case 'note':
      return applyNote(state, change, ctx);
    case 'todo':
      return applyTodo(state, change, ctx);
    case 'task':
      return applyTask(state, change, ctx);
    default:
      return false;
  }
}

// Re-export per-entity appliers and shared helpers so existing import sites
// (and tests) that reach into the barrel keep working.
export { applyProject } from './apply/projects';
export { applyCollection } from './apply/collections';
export { applyLink, sortLinksByOrder } from './apply/links';
export { applyNote, buildNote, mergeNote } from './apply/notes';
export { applyTodo, buildTodo, mergeTodo } from './apply/todos';
export { applyTask, buildTask, mergeTask } from './apply/tasks';
export { detectConflicts, touchedFieldsOf } from './apply/conflicts';
export * from './apply/shared';
