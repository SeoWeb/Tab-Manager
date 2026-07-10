import type { AppState } from '../types';
import type {
  CloudPresenceUser,
  CloudRole,
  CloudSyncChange,
  CloudSyncState,
  SyncConflictItem,
  SyncConflictResolution,
} from '@/lib/cloudflareSync/types';
import { applyRemoteChanges } from '@/lib/cloudflareSync/applyChanges';
import {
  buildNotePatch,
  buildTaskPatch,
} from '@/lib/cloudflareSync/entityPatches';

type SetState = (
  partial:
    | Partial<AppState>
    | ((state: AppState) => Partial<AppState> | AppState),
  replace?: boolean
) => void;

export const createCloudSyncActions = (
  _set: SetState,
  get: () => AppState
) => ({
  /**
   * Merge a partial patch into the `cloudSync` slice. Cursors are intentionally
   * excluded from this setter; use `setProjectCursor` for those.
   */
  setCloudSyncState: (
    patch: Partial<Omit<CloudSyncState, 'cursors'>>
  ): void => {
    _set((state: AppState) => ({
      cloudSync: { ...state.cloudSync, ...patch },
    }));
  },

  /** Record the change-log cursor for a project after a successful pull. */
  setProjectCursor: (projectId: string, cursor: number): void => {
    _set((state: AppState) => ({
      cloudSync: {
        ...state.cloudSync,
        cursors: { ...state.cloudSync.cursors, [projectId]: cursor },
      },
    }));
  },

  /** Forget the change-log cursor for a single project (e.g. on disconnect). */
  clearProjectCursor: (projectId: string): void => {
    _set((state: AppState) => {
      const rest = { ...state.cloudSync.cursors };
      delete rest[projectId];
      return { cloudSync: { ...state.cloudSync, cursors: rest } };
    });
  },

  /** Clear all per-project cursors (e.g. on sign-out). */
  clearProjectCursors: (): void => {
    _set((state: AppState) => ({
      cloudSync: { ...state.cloudSync, cursors: {} },
    }));
  },

  /**
   * Fold server change-log rows into the local store. Own echoes (changes whose
   * `client_id` matches) are skipped so optimistic local state is preserved.
   * Remote changes that would clobber a field we have a pending local edit for
   * are detected (via `pendingEdits`) and surfaced as conflicts instead of being
   * silently dropped.
   */
  mergeRemoteChanges: (changes: CloudSyncChange[], clientId: string): void => {
    const state = get();
    const result = applyRemoteChanges(
      {
        projects: state.projects,
        notes: state.notes,
        todos: state.todos,
        tasks: state.tasks,
      },
      changes,
      clientId,
      state.cloudSync.pendingEdits
    );

    _set({
      projects: result.projects,
      notes: result.notes,
      todos: result.todos,
      tasks: result.tasks,
    });

    if (result.conflicts.length) get().addSyncConflicts(result.conflicts);
  },

  /**
   * Merge newly detected conflicts into the pending list, de-duplicating by id
   * (the same change can arrive over both realtime and the next pull).
   */
  addSyncConflicts: (items: SyncConflictItem[]): void => {
    if (!items.length) return;
    _set((state: AppState) => {
      const existing = new Set(state.syncConflicts.map((c) => c.id));
      const merged = [
        ...state.syncConflicts,
        ...items.filter((c) => !existing.has(c.id)),
      ];
      return { syncConflicts: merged };
    });
  },

  /** Apply a user's resolution to a field conflict (local / remote / merge). */
  resolveSyncConflict: (
    id: string,
    resolution: SyncConflictResolution
  ): void => {
    const conflict = get().syncConflicts.find((c) => c.id === id);
    if (!conflict) return;

    if (resolution === 'local') {
      // Keep the local value; re-push it so the server adopts our edit.
      pushResolvedValue(get, conflict);
      get().dismissSyncConflict(id);
      return;
    }

    _set((state: AppState) => {
      const next = applyResolution(state, conflict, resolution);
      return {
        ...next,
        syncConflicts: state.syncConflicts.filter((c) => c.id !== id),
      };
    });

    if (resolution === 'merge') {
      // Merging produced a local-only value that must be pushed too.
      pushResolvedValue(get, conflict);
    }
  },

  /** Drop a conflict from the list without applying either side. */
  dismissSyncConflict: (id: string): void => {
    _set((state: AppState) => ({
      syncConflicts: state.syncConflicts.filter((c) => c.id !== id),
    }));
  },

  /** Clear all pending conflicts (e.g. on sign-out). */
  clearSyncConflicts: (): void => {
    _set({ syncConflicts: [] });
  },

  /** Toggle a project's cloud-synced flag without touching its data. */
  setProjectCloudEnabled: (projectId: string, enabled: boolean): void => {
    _set((state: AppState) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              cloudEnabled: enabled,
              ...(!enabled ? { cloudRole: 'owner' } : {}),
            }
          : p
      ),
    }));
  },

  /** Mark the active project's realtime socket as connected/disconnected. */
  setRealtimeConnected: (connected: boolean): void => {
    _set((state: AppState) => ({
      cloudSync: { ...state.cloudSync, realtimeConnected: connected },
    }));
  },

  /** Replace the active project's realtime presence roster. */
  setOnlinePresence: (users: CloudPresenceUser[]): void => {
    _set((state: AppState) => ({
      cloudSync: { ...state.cloudSync, onlinePresence: users ?? [] },
    }));
  },

  /**
   * Record the current user's role on a cloud project (Phase 4). Refreshed from
   * `GET /projects/:id` during sync and set when a project is created, converted,
   * or joined via invite. Local-only projects keep no role (undefined = full UI).
   */
  setProjectCloudRole: (projectId: string, role: CloudRole): void => {
    _set((state: AppState) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, cloudRole: role } : p
      ),
    }));
  },

  /**
   * Re-key a local project to its server-assigned id and mark it cloud-enabled.
   * `activeProjectId` is remapped so the current selection survives the id change.
   *
   * The flat per-project entities (notes/todos/tasks) are re-keyed too: they
   * carry the old local `projectId`, so without remapping they would be orphaned
   * under the old id once the project moves to its server id (the views filter by
   * the new active project id). Collections/links are nested under the project,
   * so they follow automatically and need no remap. (Phase B3.)
   */
  convertProjectToCloudState: (
    localId: string,
    serverProjectId: string
  ): void => {
    _set((state: AppState) => ({
      projects: state.projects.map((p) =>
        p.id === localId
          ? {
              ...p,
              id: serverProjectId,
              cloudEnabled: true,
              updatedAt: new Date(),
            }
          : p
      ),
      activeProjectId:
        state.activeProjectId === localId
          ? serverProjectId
          : state.activeProjectId,
      notes: state.notes.map((n) =>
        n.projectId === localId ? { ...n, projectId: serverProjectId } : n
      ),
      todos: state.todos.map((t) =>
        t.projectId === localId ? { ...t, projectId: serverProjectId } : t
      ),
      tasks: state.tasks.map((t) =>
        t.projectId === localId ? { ...t, projectId: serverProjectId } : t
      ),
    }));
  },
});

// ---------------------------------------------------------------------------
// Conflict resolution helpers
//
// A field conflict means a remote change would overwrite a field we have a
// pending local edit for. Resolution applies the chosen value locally; for
// `local`/`merge` the resulting local value is re-pushed so the server adopts
// it (the server holds the remote value for that field until then).
// ---------------------------------------------------------------------------

const DATE_FIELDS = new Set(['dueDate', 'scheduledDate', 'completedAt']);

function reviveForField(field: string, value: unknown): unknown {
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }
  return value;
}

/** Combine two values for a `merge` resolution; text joins, others take remote. */
function mergeValues(local: unknown, remote: unknown): unknown {
  if (typeof local === 'string' && typeof remote === 'string') {
    if (local === remote) return local;
    return `${local}\n\n---\n\n${remote}`;
  }
  return remote;
}

function applyResolution(
  state: AppState,
  conflict: SyncConflictItem,
  resolution: SyncConflictResolution
): Partial<AppState> {
  const { entityType, entityId, field, localValue, remoteValue } = conflict;
  let setValue: unknown = remoteValue;
  if (resolution === 'merge') setValue = mergeValues(localValue, remoteValue);
  setValue = reviveForField(field, setValue);

  if (entityType === 'task') {
    return {
      tasks: state.tasks.map((t) =>
        t.id === entityId ? { ...t, [field]: setValue } : t
      ),
    };
  }
  if (entityType === 'note') {
    return {
      notes: state.notes.map((n) =>
        n.id === entityId ? { ...n, [field]: setValue } : n
      ),
    };
  }
  if (entityType === 'todo') {
    return {
      todos: state.todos.map((t) =>
        t.id === entityId ? { ...t, [field]: setValue } : t
      ),
    };
  }
  return {};
}

/** Re-push the current local value of a conflicting entity so the server adopts it. */
function pushResolvedValue(
  get: () => AppState,
  conflict: SyncConflictItem
): void {
  const state = get();
  if (conflict.entityType === 'task') {
    const task = state.tasks.find((t) => t.id === conflict.entityId);
    if (task) {
      void import('@/lib/cloudflareSync/orchestrator').then((m) =>
        m.enqueueCloudChange({
          projectId: conflict.projectId,
          entityType: 'task',
          entityId: conflict.entityId,
          operation: 'update',
          patch: buildTaskPatch(task),
        })
      );
    }
  } else if (conflict.entityType === 'note') {
    const note = state.notes.find((n) => n.id === conflict.entityId);
    if (note) {
      void import('@/lib/cloudflareSync/orchestrator').then((m) =>
        m.enqueueCloudChange({
          projectId: conflict.projectId,
          entityType: 'note',
          entityId: conflict.entityId,
          operation: 'update',
          patch: buildNotePatch(note),
        })
      );
    }
  }
}
