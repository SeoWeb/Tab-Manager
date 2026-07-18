import * as client from './client';
import * as config from './config';
import * as queue from './queue';
import { diffSnapshot } from './reconcile';
import { canEdit } from './roles';
import type { CloudRole } from './types';
import { acquireSyncLock, releaseSyncLock } from './syncLock';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type { Collection } from '@/types';
import type { Note } from '@/stores/types';
import type {
  CloudEntityType,
  CloudOperation,
  CloudSyncChange,
  CloudSyncStatus,
} from './types';
import {
  errorMessage,
  isOnline,
  nowIso,
  readPersistedState,
} from './backgroundSyncImpl/storage';
import {
  applyReconcileToStore,
  applyToStore,
} from './backgroundSyncImpl/applyToStore';

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

/**
 * Run one background reconciliation pass across every cloud-enabled (or queued)
 * project. Mirror of `backgroundSyncAll` but uses the full snapshot diff instead
 * of the incremental cursor pull: it fetches `GET /projects/:id/snapshot`, runs
 * `diffSnapshot`, applies the pull (create/update/delete-locally) changes through
 * the same `applyRemoteChanges` reducer the popup uses, and enqueues the push
 * (local-newer / local-only) items via `queue.enqueueMutation` for the next
 * incremental sync to send. Safe to call from the service worker. Advances only
 * `lastReconciledAt`, never the incremental `lastSyncedAt` cursor heartbeat.
 */
export async function backgroundReconcileAll(): Promise<{
  projects: number;
  status: CloudSyncStatus;
}> {
  if (!(await acquireSyncLock('background'))) {
    return { projects: 0, status: 'idle' };
  }

  let status: CloudSyncStatus = 'synced';
  let lastError: string | null = null;
  let reconciledProjects = 0;

  // pullsByProject: reconcile pulls to fold into the store at write time.
  const pullsByProject = new Map<string, CloudSyncChange[]>();
  // pushes: local-newer / local-only entities to enqueue as mutations.
  const pushes: Array<{
    projectId: string;
    entityType: CloudEntityType;
    entityId: string;
    operation: CloudOperation;
    patch: Record<string, unknown>;
    baseVersion?: number;
  }> = [];

  try {
    const wrapper = await readPersistedState();
    if (!wrapper?.state?.cloudSync?.enabled) {
      return { projects: 0, status: 'idle' };
    }

    const projects = (wrapper.state.projects ?? []) as Array<{
      id: string;
      cloudEnabled?: boolean;
      cloudRole?: CloudRole;
      collections?: Collection[];
    }>;
    const allNotes = (wrapper.state.notes ?? []) as Note[];
    const allTodos = (wrapper.state.todos ?? []) as LegacyTask[];
    const allTasks = (wrapper.state.tasks ?? []) as AdvancedTask[];

    const queueSnapshot = await queue.getQueue();
    const targetIds = new Set<string>([
      ...projects.filter((p) => p.cloudEnabled).map((p) => p.id),
      ...queueSnapshot.map((m) => m.projectId),
    ]);

    if (targetIds.size === 0) {
      return { projects: 0, status: 'idle' };
    }

    for (const projectId of targetIds) {
      const project = projects.find((p) => p.id === projectId);
      const role = project?.cloudRole;
      const queuedIds = new Set(
        queueSnapshot
          .filter((m) => m.projectId === projectId)
          .map((m) => m.entityId)
      );
      try {
        const server = await client.getProjectSnapshot(projectId);
        const diff = diffSnapshot({
          collections: project?.collections ?? [],
          tasks: allTasks.filter((t) => t.projectId === projectId),
          notes: allNotes.filter((n) => n.projectId === projectId),
          todos: allTodos.filter((t) => t.projectId === projectId),
          server,
          queuedEntityIds: queuedIds,
        });

        if (diff.pulls.length) {
          pullsByProject.set(projectId, diff.pulls);
        }

        // Viewers (role < editor) are pull-only; skip pushes (server enforces
        // this too). Pushes are enqueued as normal mutations and sent by the
        // next incremental sync.
        if (canEdit(role)) {
          for (const push of diff.pushes) {
            pushes.push({
              projectId,
              entityType: push.entityType,
              entityId: push.entityId,
              operation: push.operation,
              patch: push.patch,
              ...(push.baseVersion !== undefined
                ? { baseVersion: push.baseVersion }
                : {}),
            });
          }
        }
        reconciledProjects += 1;
      } catch (error) {
        status = isOnline() ? 'error' : 'offline';
        lastError = errorMessage(error);
      }
    }
  } finally {
    await releaseSyncLock('background');
  }

  // Enqueue pushes (local-newer / local-only) as normal mutations. The next
  // incremental sync pushes them; the queue is locked internally so this is
  // safe alongside a concurrent popup enqueue.
  for (const push of pushes) {
    await queue.enqueueMutation({
      clientMutationId: crypto.randomUUID(),
      clientId: await config.getClientId(),
      createdAt: nowIso(),
      projectId: push.projectId,
      entityType: push.entityType,
      entityId: push.entityId,
      operation: push.operation,
      patch: push.patch,
      ...(push.baseVersion !== undefined
        ? { baseVersion: push.baseVersion }
        : {}),
    });
  }

  // Fold pulled changes into the freshest persisted state and write back,
  // advancing `lastReconciledAt` only (never `lastSyncedAt`).
  await applyReconcileToStore({ pullsByProject, status, lastError });

  return { projects: reconciledProjects, status };
}

/** Read the last reconciliation timestamp from the persisted cloud-sync state. */
export async function getLastReconciledAt(): Promise<string | null> {
  const wrapper = await readPersistedState();
  return wrapper?.state?.cloudSync?.lastReconciledAt ?? null;
}
