import { applyRemoteChanges, type ApplyChangesInput } from '../applyChanges';
import * as config from '../config';
import type {
  CloudSyncChange,
  CloudSyncState,
  CloudSyncStatus,
} from '../types';
import {
  nowIso,
  readStoreRaw,
  writeStoreRaw,
  type PersistedWrapper,
  type PartialState,
} from './storage';

/**
 * Read-modify-write: re-read the freshest persisted state, apply only the
 * pulled changes each project hasn't already seen (by fresh cursor), advance
 * cursors, set sync status, and write back. This is what keeps background sync
 * from clobbering the popup's in-flight local edits or double-applying changes
 * the popup already received over its realtime socket.
 */
export async function applyToStore(input: {
  changesByProject: Map<string, CloudSyncChange[]>;
  cursorsAfter: Map<string, number>;
  status: CloudSyncStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
}): Promise<void> {
  if (input.changesByProject.size === 0 && input.cursorsAfter.size === 0) {
    return;
  }

  const raw = await readStoreRaw();
  if (!raw) return;

  let wrapper: PersistedWrapper;
  try {
    wrapper = JSON.parse(raw) as PersistedWrapper;
  } catch {
    return;
  }
  const state = wrapper.state ?? (wrapper as unknown as PartialState);
  if (!state) return;

  const freshCursors = { ...(state.cloudSync?.cursors ?? {}) };
  // The persisted state is loosely typed; cast into the reducer's input shape.
  const mutable: ApplyChangesInput = {
    projects: (state.projects ?? []) as ApplyChangesInput['projects'],
    notes: (state.notes ?? []) as ApplyChangesInput['notes'],
    todos: (state.todos ?? []) as ApplyChangesInput['todos'],
    tasks: (state.tasks ?? []) as ApplyChangesInput['tasks'],
  };

  for (const [projectId, changes] of input.changesByProject) {
    const freshCursor = freshCursors[projectId] ?? 0;
    // Skip changes the popup already applied (e.g. via realtime) while the
    // background was pulling — applying them again would duplicate work.
    const pending = changes.filter((c) => c.id > freshCursor);
    if (pending.length === 0) {
      // Still advance the cursor if the pull saw further than the popup has.
      const pulled = input.cursorsAfter.get(projectId) ?? freshCursor;
      if (pulled > freshCursor) freshCursors[projectId] = pulled;
      continue;
    }
    const result = applyRemoteChanges(
      mutable,
      pending,
      await config.getClientId()
    );
    mutable.projects = result.projects;
    mutable.notes = result.notes;
    mutable.todos = result.todos;
    mutable.tasks = result.tasks;
    const maxId = pending.reduce(
      (max, c) => (c.id > max ? c.id : max),
      freshCursor
    );
    freshCursors[projectId] = Math.max(
      maxId,
      input.cursorsAfter.get(projectId) ?? freshCursor
    );
  }

  state.projects = mutable.projects;
  state.notes = mutable.notes;
  state.todos = mutable.todos;
  state.tasks = mutable.tasks;
  state.cloudSync = {
    ...(state.cloudSync as CloudSyncState),
    cursors: freshCursors,
    status: input.status,
    lastError: input.lastError,
    ...(input.lastSyncedAt ? { lastSyncedAt: input.lastSyncedAt } : {}),
  };

  await writeStoreRaw(JSON.stringify(wrapper));
}

/**
 * Read-modify-write for reconciliation: re-read the freshest persisted state,
 * apply the (already conflict-free) pull changes each project is missing, and
 * write back — reusing the same `applyRemoteChanges` reducer so apply semantics
 * match the popup exactly. Advances only `lastReconciledAt`; the incremental
 * `lastSyncedAt` cursor heartbeat is left untouched so sync-staleness detection
 * keeps working independently of reconcile.
 */
export async function applyReconcileToStore(input: {
  pullsByProject: Map<string, CloudSyncChange[]>;
  status: CloudSyncStatus;
  lastError: string | null;
}): Promise<void> {
  const raw = await readStoreRaw();
  if (!raw) return;

  let wrapper: PersistedWrapper;
  try {
    wrapper = JSON.parse(raw) as PersistedWrapper;
  } catch {
    return;
  }
  const state = wrapper.state ?? (wrapper as unknown as PartialState);
  if (!state) return;

  // The persisted state is loosely typed; cast into the reducer's input shape.
  const mutable: ApplyChangesInput = {
    projects: (state.projects ?? []) as ApplyChangesInput['projects'],
    notes: (state.notes ?? []) as ApplyChangesInput['notes'],
    todos: (state.todos ?? []) as ApplyChangesInput['todos'],
    tasks: (state.tasks ?? []) as ApplyChangesInput['tasks'],
  };

  const clientId = await config.getClientId();
  for (const changes of input.pullsByProject.values()) {
    const result = applyRemoteChanges(mutable, changes, clientId);
    mutable.projects = result.projects;
    mutable.notes = result.notes;
    mutable.todos = result.todos;
    mutable.tasks = result.tasks;
  }

  state.projects = mutable.projects;
  state.notes = mutable.notes;
  state.todos = mutable.todos;
  state.tasks = mutable.tasks;
  state.cloudSync = {
    ...(state.cloudSync as CloudSyncState),
    status: input.status,
    lastError: input.lastError,
    lastReconciledAt: nowIso(),
  };

  await writeStoreRaw(JSON.stringify(wrapper));
}
