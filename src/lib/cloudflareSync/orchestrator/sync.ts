import { useAppStore } from '@/stores/appStore';
import * as client from '../client';
import * as config from '../config';
import * as queue from '../queue';
import { acquireSyncLock, releaseSyncLock } from '../syncLock';
import {
  isOnline,
  nowIso,
  setCloudState,
  formatConflicts,
  errorMessage,
} from './internal';
import { refreshProjectRole } from './collaboration';
import { reconcileProject } from './reconcile';
import type { CloudSyncStatus } from '../types';

/**
 * Push queued mutations for a project and pull changes since the last cursor.
 * Applies remote changes to the store, clears acknowledged mutations, and updates
 * status. Safe to call from the manual sync button.
 */
export async function syncProjectNow(projectId: string): Promise<void> {
  const { cloudSync } = useAppStore.getState();

  if (!cloudSync.enabled) {
    setCloudState({ lastError: 'Cloud sync is not enabled.' });
    return;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return;
  }

  // Avoid racing the background service worker's sync: if it holds the advisory
  // lock, defer — it will push/pull this project's changes itself. (Same-owner
  // re-entry from syncAllCloudProjects is allowed.)
  if (!(await acquireSyncLock('popup'))) {
    return;
  }

  setCloudState({ status: 'syncing', lastError: null });

  try {
    // Conflicted entries are excluded (fix-cross-context-data-loss 7.1): they
    // stay queued until the user resolves or discards the conflict; retrying a
    // CAS rejection can never succeed, so they are not re-sent.
    const mutations = await queue.getPushableQueueForProject(projectId);
    // Read the cursor INSIDE the lock window (fix-cross-context-data-loss
    // 3.1): the `cloudSync` snapshot above was taken before the lock was
    // acquired, so a background pass could have completed its own locked
    // read-modify-write — including a cursor advance for this project — in
    // between. Reading now, under the lock, mirrors the background path,
    // which snapshots cursors after acquiring.
    const lastCursor =
      useAppStore.getState().cloudSync.cursors[projectId] ?? null;
    const response = await client.syncProject({
      projectId,
      lastCursor,
      mutations,
    });

    // Apply remote changes (skips our own echoes by client id) — unless the
    // server flagged us as a lagging client (see the fallback below): the
    // flagged response's `changes` is empty BY DESIGN (our cursor predates the
    // pruned change-log window), so there is nothing to merge and the full
    // snapshot reconcile supplies the state instead.
    const clientId = await config.getClientId();
    const store = useAppStore.getState();
    if (response.reconcileRequired !== true) {
      store.mergeRemoteChanges(response.changes, clientId);
    }

    // The server reports exactly one outcome per pushed mutation. Only
    // finalized mutations leave the queue: `applied` (accepted) and `skipped`
    // (permanently rejected; warned and dropped to avoid a retry loop).
    // `conflict` outcomes RETAIN their mutation, flagged `conflicted`
    // (fix-cross-context-data-loss 7.1) — the queued local edit survives until
    // the user resolves or discards the conflict, which releases it.
    // `error` outcomes and missing entries keep their mutation queued for the
    // next sync, so nothing is silently lost.
    const settlement = await queue.settleMutationOutcomes(
      mutations,
      response.outcomes
    );
    const remaining = settlement.queue;
    setCloudState({ pendingEdits: queue.pendingEditsFromQueue(remaining) });
    // Surface how many queued mutations are conflicted so the status badge can
    // show the unresolved-conflict count (setCloudState's patch type doesn't
    // carry the field, so go through the store action directly).
    useAppStore.getState().setCloudSyncState({
      conflictedMutationCount: settlement.conflicted.length,
    });

    store.setProjectCursor(projectId, response.cursor);

    // Best-effort: refresh the current user's role so client-side role gating
    // stays accurate even after an admin changes it elsewhere. Never blocks or
    // fails the sync — a stale role only affects which UI controls are offered.
    void refreshProjectRole(projectId);

    setCloudState({
      status: response.conflicts.length ? 'conflict' : 'synced',
      lastSyncedAt: nowIso(),
      pendingMutationCount: remaining.length,
      lastError: response.conflicts.length
        ? formatConflicts(projectId, response.conflicts)
        : null,
    });

    // Lagging-client fallback (scale-sync-backend, change-log-retention): the
    // server flagged `reconcileRequired` because our incremental cursor points
    // into the pruned change-log window — the incremental delta would be
    // incomplete, so it answered `changes: []` and we must rebuild from the
    // full snapshot instead. The pushed mutations above were still applied
    // server-side (their outcomes are real), and we DID advance the cursor to
    // the response's fresh max change id: that value sits at/above the
    // pruning horizon (pruning deletes oldest-first, so every retained change
    // id exceeds every pruned one), which means the staleness predicate
    // (`lastCursor < max_pruned_change_id`) can never fire again for this
    // horizon — no re-entry loop. The reconcile itself only ever calls the
    // snapshot endpoint, never the sync endpoint, so it cannot observe (or
    // re-enter) this flagged branch. (Note: reconcile deliberately does NOT
    // touch the incremental cursor — the advance here is what breaks the
    // cycle.)
    if (response.reconcileRequired === true) {
      console.warn(
        `[cloudSync] server flagged reconcileRequired for project ${projectId}; falling back to full snapshot reconcile`
      );
      // We already hold the popup sync lock, so run the reconcile with
      // `force`: that skips acquiring/releasing the advisory lock (a non-force
      // call would "acquire" our own lock and then release it in its finally,
      // opening a window for the background worker mid-sync).
      await reconcileProject(projectId, { force: true });
    }
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
  } finally {
    await releaseSyncLock('popup');
  }
}

/**
 * Sync every cloud-enabled project in turn. Used by the global "Sync now" button.
 *
 * Since Phase 3 the cloud/local distinction is explicit (`project.cloudEnabled`),
 * so we sync exactly those projects. Any project with stray queued mutations is
 * also included as a safety net (e.g. a project that was disconnected while
 * mutations were still pending).
 */
export async function syncAllCloudProjects(): Promise<void> {
  const state = useAppStore.getState();
  const cloudProjectIds = new Set(
    state.projects.filter((p) => p.cloudEnabled).map((p) => p.id)
  );
  const queuedProjectIds = new Set(
    (await queue.getQueue()).map((m) => m.projectId)
  );
  const targetProjectIds = [
    ...new Set([...cloudProjectIds, ...queuedProjectIds]),
  ];

  if (targetProjectIds.length === 0) {
    // Nothing is cloud-enabled yet.
    setCloudState({ status: 'idle', lastError: null });
    return;
  }

  for (const projectId of targetProjectIds) {
    await syncProjectNow(projectId);
  }
}
