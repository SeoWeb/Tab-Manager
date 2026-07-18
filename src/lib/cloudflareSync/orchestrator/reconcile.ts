import { useAppStore } from '@/stores/appStore';
import * as client from '../client';
import * as config from '../config';
import * as queue from '../queue';
import { acquireSyncLock, releaseSyncLock } from '../syncLock';
import { diffSnapshot } from '../reconcile';
import { enqueueCloudChange } from './enqueue';
import { canEdit } from '../roles';
import { isOnline, nowIso, setCloudState, errorMessage } from './internal';
import type { SnapshotResponse } from '../types';

/**
 * Run a full reconciliation for a single cloud project. Guards on cloud-enabled +
 * online + the advisory sync lock, fetches the snapshot, runs `diffSnapshot`,
 * applies pulls via `applyRemoteChanges`, enqueues pushes via `enqueueCloudChange`
 * (role/queue gated), and records `lastReconciledAt`.
 */
export async function reconcileProject(
  projectId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const state = useAppStore.getState();
  const { cloudSync } = state;
  if (!cloudSync.enabled) return;

  const project = state.projects.find((p) => p.id === projectId);
  if (!project?.cloudEnabled) return;

  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return;
  }

  // Avoid racing the incremental sync / background worker on the same lock owner.
  // `force` skips acquiring the advisory lock so a manual reconcile can run even
  // while the background worker holds it; use it only for an explicit user action.
  // Track whether WE acquired the lock so we only release what we own.
  let acquiredLock = false;
  if (!options.force) {
    if (!(await acquireSyncLock('popup'))) return;
    acquiredLock = true;
  }

  setCloudState({ status: 'syncing', lastError: null });
  try {
    const server: SnapshotResponse = await client.getProjectSnapshot(projectId);
    const clientId = await config.getClientId();
    const role = project.cloudRole;
    const queued = await queue.getQueueForProject(projectId);
    const queuedIds = new Set(queued.map((m) => m.entityId));

    const diff = diffSnapshot({
      collections: project.collections,
      tasks: state.tasks.filter((t) => t.projectId === projectId),
      notes: state.notes.filter((n) => n.projectId === projectId),
      todos: state.todos.filter((t) => t.projectId === projectId),
      server,
      queuedEntityIds: queuedIds,
    });

    // Apply pulls (create/update/delete-locally) through the existing reducer so
    // nesting + field-level conflict detection are preserved. `mergeRemoteChanges`
    // reuses `applyRemoteChanges` and records any field-level conflicts into
    // `syncConflicts`, which the `SyncConflictsPanel` surfaces.
    const conflictsBefore = useAppStore.getState().syncConflicts.length;
    if (diff.pulls.length) {
      useAppStore.getState().mergeRemoteChanges(diff.pulls, clientId);
    }
    const hasConflicts =
      useAppStore.getState().syncConflicts.length > conflictsBefore;

    // Pushes (local-newer / local-only) are enqueued as normal mutations. Viewers
    // (role < editor) are pull-only and skip pushes (the server enforces this too).
    if (canEdit(role)) {
      for (const push of diff.pushes) {
        await enqueueCloudChange({
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

    // Reconcile advances only `lastReconciledAt`, never the incremental
    // `lastSyncedAt` cursor heartbeat. Conflicts (if any) are surfaced via the
    // existing `SyncConflictsPanel`, so the status reflects them.
    setCloudState({
      status: hasConflicts ? 'conflict' : 'synced',
      lastReconciledAt: nowIso(),
      lastError: hasConflicts
        ? `${useAppStore.getState().syncConflicts.length} reconcile conflict(s)`
        : null,
    });
  } catch (error) {
    setCloudState({
      status: isOnline() ? 'error' : 'offline',
      lastError: errorMessage(error),
    });
  } finally {
    // Only release the lock when we actually acquired it. Force mode bypasses
    // acquireSyncLock so we must not release a lock owned by the background sync.
    if (acquiredLock) await releaseSyncLock('popup');
  }
}

/**
 * Reconcile every cloud-enabled (or queued) project in turn. Mirrors
 * `syncAllCloudProjects` but runs the snapshot diff instead of the cursor pull.
 */
export async function reconcileAllCloudProjects(): Promise<void> {
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
    setCloudState({ status: 'idle', lastError: null });
    return;
  }

  for (const projectId of targetProjectIds) {
    await reconcileProject(projectId);
  }
}
