import * as client from './client';
import * as config from './config';
import * as queue from './queue';
import { applyRemoteChanges, type ApplyChangesInput } from './applyChanges';
import { acquireSyncLock, releaseSyncLock } from './syncLock';
import type { CloudSyncChange, CloudSyncState, CloudSyncStatus } from './types';

/**
 * Phase 5 background sync.
 *
 * Runs in the service worker on `chrome.alarms` / startup. It is deliberately
 * DOM-free and does NOT import the React app store (which pulls bookmark/tab/
 * DOM modules). Instead it reads the persisted Zustand JSON straight from
 * `chrome.storage.local`, pushes the queued mutations, pulls remote changes,
 * and writes them back — reusing the same pure `applyRemoteChanges` reducer the
 * popup uses, so apply semantics are identical.
 *
 * Concurrency: the whole run holds the advisory sync lock. The store write is a
 * read-modify-write at the END against the freshest persisted state, and pulled
 * changes are filtered by the fresh per-project cursor — so a popup that is open
 * and receiving realtime updates neither has its local edits clobbered nor gets
 * the same changes double-applied.
 */

/** Zustand persist stores the partialized state as `{ state, version }`. */
const STORE_KEY = 'tab-manager-storage';

interface PersistedWrapper {
  state?: PartialState;
  version?: number;
}

interface PartialState {
  projects?: unknown[];
  notes?: unknown[];
  todos?: unknown[];
  tasks?: unknown[];
  cloudSync?: Partial<CloudSyncState>;
}

function isChromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
}

function readStoreRaw(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve(null);
    chrome.storage.local.get([STORE_KEY], (result) => {
      const value = result?.[STORE_KEY];
      resolve(typeof value === 'string' ? value : null);
    });
  });
}

function writeStoreRaw(value: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve();
    chrome.storage.local.set({ [STORE_KEY]: value }, () => resolve());
  });
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Run one background sync pass across every cloud-enabled (or queued) project.
 * Safe to call from the service worker on alarm/startup. Returns a short
 * summary for logging.
 */
export async function backgroundSyncAll(): Promise<{
  projects: number;
  status: CloudSyncStatus;
}> {
  // The popup's manual/realtime sync is the richer path; if it is mid-flight,
  // let it finish and skip this pass. Owners are per-context ('background' vs
  // 'popup') so the two can tell each other apart.
  if (!(await acquireSyncLock('background'))) {
    return { projects: 0, status: 'idle' };
  }

  let status: CloudSyncStatus = 'synced';
  let lastError: string | null = null;
  let lastSyncedAt: string | null = null;
  let syncedProjects = 0;

  // changesByProject: pulled changes to fold into the store at write time.
  // cursorsAfter: the new cursor per project (max of pulled + existing).
  const changesByProject = new Map<string, CloudSyncChange[]>();
  const cursorsAfter = new Map<string, number>();

  try {
    // Snapshot the cursors + queue to drive the push/pull. (The final store
    // write re-reads the freshest state, so a stale snapshot here is harmless.)
    const wrapper = await readPersistedState();
    if (!wrapper?.state?.cloudSync?.enabled) {
      return { projects: 0, status: 'idle' };
    }
    const cursorsBefore = { ...(wrapper.state.cloudSync.cursors ?? {}) };
    const projects = (wrapper.state.projects ?? []) as Array<{
      id: string;
      cloudEnabled?: boolean;
    }>;

    const queueSnapshot = await queue.getQueue();
    const targetIds = new Set<string>([
      ...projects.filter((p) => p.cloudEnabled).map((p) => p.id),
      ...queueSnapshot.map((m) => m.projectId),
    ]);

    if (targetIds.size === 0) {
      return { projects: 0, status: 'idle' };
    }

    for (const projectId of targetIds) {
      const mutations = queueSnapshot.filter((m) => m.projectId === projectId);
      const lastCursor = cursorsBefore[projectId] ?? null;
      try {
        const response = await client.syncProject({
          projectId,
          lastCursor,
          mutations,
        });
        changesByProject.set(projectId, response.changes);
        cursorsAfter.set(projectId, response.cursor);
        syncedProjects += 1;
        lastSyncedAt = nowIso();
        if (response.conflicts.length) {
          status = 'conflict';
          const first = response.conflicts[0];
          lastError = `${response.conflicts.length} sync conflict(s): ${first.entityType} ${first.entityId} — ${first.message}`;
        }
        // Remove only the mutations we just pushed (safe read-modify-write that
        // preserves any mutations the popup enqueued concurrently).
        if (mutations.length) {
          await queue.removeMutations(mutations.map((m) => m.clientMutationId));
        }
      } catch (error) {
        status = isOnline() ? 'error' : 'offline';
        lastError = errorMessage(error);
        // Leave the cursor and queue untouched so the next pass retries.
      }
    }
  } finally {
    await releaseSyncLock('background');
  }

  // Fold pulled changes into the freshest persisted state and write back.
  await applyToStore({
    changesByProject,
    cursorsAfter,
    status,
    lastError,
    lastSyncedAt,
  });

  return { projects: syncedProjects, status };
}

async function readPersistedState(): Promise<PersistedWrapper | null> {
  const raw = await readStoreRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedWrapper;
    // Tolerate a legacy flat shape (state stored without the wrapper).
    if (parsed && parsed.state) return parsed;
    if (parsed && typeof parsed === 'object' && 'projects' in parsed) {
      return { state: parsed as PartialState };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write: re-read the freshest persisted state, apply only the
 * pulled changes each project hasn't already seen (by fresh cursor), advance
 * cursors, set sync status, and write back. This is what keeps background sync
 * from clobbering the popup's in-flight local edits or double-applying changes
 * the popup already received over its realtime socket.
 */
async function applyToStore(input: {
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
