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
    const mutations = await queue.getQueueForProject(projectId);
    const lastCursor = cloudSync.cursors[projectId] ?? null;
    const response = await client.syncProject({
      projectId,
      lastCursor,
      mutations,
    });

    // Apply remote changes (skips our own echoes by client id).
    const clientId = await config.getClientId();
    const store = useAppStore.getState();
    store.mergeRemoteChanges(response.changes, clientId);

    // The server applies accepted mutations idempotently and reports the rest as
    // conflicts. Under last-write-wins a structurally-conflicted mutation (e.g.
    // an update of an entity that was deleted remotely) will not succeed on retry,
    // so we drop every pushed mutation — accepted or conflicted — to keep the
    // queue bounded and avoid re-reporting the same conflict on every sync.
    // Conflicts are surfaced via status + lastError; a resolution UI is a later
    // phase.
    const remaining = await queue.removeMutations(
      mutations.map((m) => m.clientMutationId)
    );
    setCloudState({ pendingEdits: queue.pendingEditsFromQueue(remaining) });

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
