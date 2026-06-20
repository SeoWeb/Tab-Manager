import type { AppState } from '../types';
import type {
  CloudPresenceUser,
  CloudRole,
  CloudSyncChange,
  CloudSyncState,
} from '@/lib/cloudflareSync/types';
import { applyRemoteChanges } from '@/lib/cloudflareSync/applyChanges';

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
   */
  mergeRemoteChanges: (changes: CloudSyncChange[], clientId: string): void => {
    const state = get();
    const result = applyRemoteChanges(
      {
        projects: state.projects,
        notes: state.notes,
        tasks: state.tasks,
      },
      changes,
      clientId
    );

    _set({
      projects: result.projects,
      notes: result.notes,
      tasks: result.tasks,
    });
  },

  /** Toggle a project's cloud-synced flag without touching its data. */
  setProjectCloudEnabled: (projectId: string, enabled: boolean): void => {
    _set((state: AppState) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, cloudEnabled: enabled } : p
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
   * The flat per-project entities (notes/tasks) are re-keyed too: they
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
      tasks: state.tasks.map((t) =>
        t.projectId === localId ? { ...t, projectId: serverProjectId } : t
      ),
    }));
  },
});
