import * as client from './client';
import * as config from './config';
import * as queue from './queue';
import { diffSnapshot } from './reconcile';
import { canEdit } from './roles';
import type { CloudRole } from './types';
import {
  acquireSyncLock,
  releaseSyncLock,
  startSyncLockHeartbeat,
  stopSyncLockHeartbeat,
} from './syncLock';
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
 * Concurrency: the whole run holds the advisory sync lock — including the
 * final store write (a read-modify-write against the freshest persisted state,
 * fix-cross-context-data-loss 3.1, mirroring `orchestrator/sync.ts`), so a
 * popup "Sync now" can never interleave its own read-modify-write inside this
 * window. A lock-keeping `chrome.alarms` heartbeat (`syncLock`) refreshes the
 * lock timestamp while the pass runs so it cannot be judged stale mid-window,
 * and a hung HTTP request cannot strand it either: every client request aborts
 * at a 30 s timeout (`client.ts`), the pass settles, and the lock is released
 * in the `finally`. Pulled changes are additionally filtered by the fresh
 * per-project cursor — so a popup that is open and receiving realtime updates
 * neither has its local edits clobbered nor gets the same changes
 * double-applied.
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
  // Keep the lock fresh for the whole pass (fix-cross-context-data-loss
  // 3.3): a long sync must not age past LOCK_FRESH_MS and be stolen mid-window.
  await startSyncLockHeartbeat('background');

  let status: CloudSyncStatus = 'synced';
  let lastError: string | null = null;
  let lastSyncedAt: string | null = null;
  let syncedProjects = 0;

  // changesByProject: pulled changes to fold into the store at write time.
  // cursorsAfter: the new cursor per project (max of pulled + existing).
  const changesByProject = new Map<string, CloudSyncChange[]>();
  const cursorsAfter = new Map<string, number>();
  // Projects the server flagged as lagging clients (scale-sync-backend): their
  // incremental delta was skipped, so they get a full snapshot reconcile after
  // this pass (see the fallback below).
  const reconcileRequiredProjects: string[] = [];

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
      // Conflicted entries are excluded from pushes (fix-cross-context-data-loss
      // 7.1): they stay queued until resolution; retrying a CAS rejection can
      // never succeed. They remain in `queueSnapshot` above so a project whose
      // only queued work is conflicted still gets its pull.
      const mutations = queueSnapshot.filter(
        (m) => m.projectId === projectId && m.conflicted !== true
      );
      const lastCursor = cursorsBefore[projectId] ?? null;
      try {
        const response = await client.syncProject({
          projectId,
          lastCursor,
          mutations,
        });
        if (response.reconcileRequired === true) {
          // Lagging client (scale-sync-backend, change-log-retention): our
          // cursor predates the pruned change-log window, so the server
          // skipped the delta and answered `changes: []` BY DESIGN. Record an
          // EMPTY change list — nothing is merged — and fall back to the full
          // snapshot reconcile after this pass. Everything else stays normal:
          // the pushed mutations were applied server-side (their outcomes are
          // real, so the queue settlement below stands). The empty entry (plus
          // the fresh cursor in `cursorsAfter`) is what makes `applyToStore`
          // advance this project's cursor to the response value: that cursor
          // sits at/above max_pruned_change_id (pruning deletes oldest-first,
          // so every retained change id exceeds every pruned one), which is
          // why the staleness predicate cannot fire again for this horizon —
          // no re-entry loop. The reconcile itself only ever calls the
          // snapshot endpoint, never the sync endpoint, so it cannot observe
          // (or re-enter) this flagged branch. (Reconcile deliberately does
          // not touch the incremental cursor — this advance breaks the cycle.)
          console.warn(
            `[backgroundSync] server flagged reconcileRequired for project ${projectId}; falling back to snapshot reconcile`
          );
          reconcileRequiredProjects.push(projectId);
          changesByProject.set(projectId, []);
        } else {
          changesByProject.set(projectId, response.changes);
        }
        cursorsAfter.set(projectId, response.cursor);
        syncedProjects += 1;
        lastSyncedAt = nowIso();
        if (response.conflicts.length) {
          status = 'conflict';
          const first = response.conflicts[0];
          lastError = `${response.conflicts.length} sync conflict(s): ${first.entityType} ${first.entityId} — ${first.message}`;
        }
        // Settle only the mutations we just pushed (serialized read-modify-write
        // that preserves any mutations the popup enqueued concurrently).
        // `applied`/`skipped` outcomes leave the queue; `conflict` outcomes are
        // flagged `conflicted` and RETAINED until resolution
        // (fix-cross-context-data-loss 7.1), while `error` outcomes and missing
        // entries stay queued so the next pass retries them.
        if (mutations.length) {
          await queue.settleMutationOutcomes(mutations, response.outcomes);
        }
      } catch (error) {
        status = isOnline() ? 'error' : 'offline';
        lastError = errorMessage(error);
        // Leave the cursor and queue untouched so the next pass retries.
      }
    }

    // Fold pulled changes into the freshest persisted state and write back
    // INSIDE the lock window (fix-cross-context-data-loss 3.1, mirroring
    // orchestrator/sync.ts): the store write is a read-modify-write against
    // the freshest persisted state, and a popup "Sync now" that interleaved
    // its own read-modify-write here could clobber this write or double-apply.
    // Never runs on the early-return paths above (their change maps are
    // empty and applyToStore is a no-op there anyway).
    await applyToStore({
      changesByProject,
      cursorsAfter,
      status,
      lastError,
      lastSyncedAt,
    });
  } finally {
    // Heartbeat first: no tick may fire once the lock record is gone.
    await stopSyncLockHeartbeat();
    await releaseSyncLock('background');
  }

  // Flagged projects converge via the full snapshot reconcile (the same entry
  // point the scheduled 30-minute reconcile uses, scoped to just these
  // projects). The sync lock was released above, so this re-acquires it: if a
  // popup sync grabbed the lock in between, the reconcile is skipped and the
  // project simply reconciles on a later pass — the cursor advance above
  // already prevents a repeated flag for this pruned horizon.
  if (reconcileRequiredProjects.length > 0) {
    await backgroundReconcileAll({
      onlyProjectIds: reconcileRequiredProjects,
    });
  }

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
 *
 * `opts.onlyProjectIds` (scale-sync-backend lagging-client fallback) scopes the
 * pass to specific projects — used by `backgroundSyncAll` when the server flags
 * a project's incremental cursor as pruned-window stale. Unset (the scheduled
 * cadence) reconciles every cloud-enabled/queued project as before.
 */
export async function backgroundReconcileAll(
  opts: { onlyProjectIds?: string[] } = {}
): Promise<{
  projects: number;
  status: CloudSyncStatus;
}> {
  if (!(await acquireSyncLock('background'))) {
    return { projects: 0, status: 'idle' };
  }
  // Snapshot pagination can take many requests: keep the lock fresh (3.3).
  await startSyncLockHeartbeat('background');

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

    // Lagging-client fallback scoping: reconcile ONLY the flagged projects.
    if (opts.onlyProjectIds) {
      const only = new Set(opts.onlyProjectIds);
      for (const id of [...targetIds]) {
        if (!only.has(id)) targetIds.delete(id);
      }
    }

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
        const server = await client.getProjectSnapshotAllPages(projectId);
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

    // Enqueue pushes (local-newer / local-only) as normal mutations, still
    // inside the lock window: the next incremental sync pushes them, and the
    // queue is locked internally so this stays safe alongside a concurrent
    // popup enqueue. Then fold pulled changes into the freshest persisted
    // state and write back (a read-modify-write, so it must not race a popup
    // sync — fix-cross-context-data-loss 3.1), advancing `lastReconciledAt`
    // only (never `lastSyncedAt`).
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

    await applyReconcileToStore({ pullsByProject, status, lastError });
  } finally {
    // Heartbeat first: no tick may fire once the lock record is gone.
    await stopSyncLockHeartbeat();
    await releaseSyncLock('background');
  }

  return { projects: reconciledProjects, status };
}

/** Read the last reconciliation timestamp from the persisted cloud-sync state. */
export async function getLastReconciledAt(): Promise<string | null> {
  const wrapper = await readPersistedState();
  return wrapper?.state?.cloudSync?.lastReconciledAt ?? null;
}
