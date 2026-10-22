import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { persistSafeStorageAdapter } from '@/stores/persistSafety';
import {
  APP_STATE_STORAGE_KEY,
  subscribeToStorageChanges,
} from '@tabspace/shared/stores/storage';
import { DEFAULT_API_BASE_URL } from '@/lib/cloudflareSync/config';
import { initialProjects } from './mockData';
import { createProjectActions } from './actions/projectActions';
import { createCollectionActions } from './actions/collectionActions';
import { createLinkActions } from './actions/linkActions';
import { createDragDropActions } from './actions/dragDropActions';
import { createUIActions } from './actions/uiActions';
import { createSidebarActions } from './actions/sidebarActions';
import { createNoteActions } from './actions/noteActions';
import { createTaskActions, initializeTaskState } from './actions/taskActions';
import { createCloudSyncActions } from './actions/cloudSyncActions';
import { mergeAppState } from './mergeAppState';

export { mergeAppState };
const initialState = {
  activeProjectId: initialProjects.length > 0 ? initialProjects[0].id : null,
  activeView: 'projectDetail' as const,
  isDarkMode: false,
  searchQuery: '',
  searchFilters: {
    projects: true,
    collections: true,
    links: true,
  },
  sortOption: 'name' as const,
  themeColor: '#3b82f6',
  activeVerticalTabId: null,
  isRightContentPanelOpen: false,
  isSidebarOpen: false,
  isSidebarLoaded: false,
  projects: initialProjects,
  chromeWindows: [],
  quickLinks: [],
  notes: [],
  todos: [],
  // Enhanced task management state
  ...initializeTaskState(),
  isAddProjectModalOpen: false,
  isAddCollectionModalOpen: false,
  isAddLinkModalOpen: false,
  isEditLinkModalOpen: false,
  editingCollectionIdForLink: null,
  editingCollectionId: null,
  editingLinkId: null,
  // Onboarding state (transient open flag, persisted completion flag)
  hasCompletedOnboarding: false,
  isOnboardingOpen: false,
  tabManagerRootFolderId: null,
  cloudSync: {
    enabled: false,
    status: 'idle' as const,
    lastSyncedAt: null,
    lastReconciledAt: null,
    lastError: null,
    pendingMutationCount: 0,
    account: null,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    cursors: {},
    realtimeConnected: false,
    onlinePresence: [],
    pendingEdits: {},
  },
  _hasHydrated: false,
  _themeFromStorage: false,
  /** Field-level sync conflicts awaiting user resolution (transient). */
  syncConflicts: [],
};

// Computes the persistable subset of app state. If snapshot computation
// fails, this returns `null` — NOT `{}`: persisting `{}` would overwrite the
// stored snapshot with an empty one and silently wipe user data. Zustand's
// `createJSONStorage` serializes a null result as the literal
// `{"state":null,"version":1}` string, which `persistSafeStorageAdapter`
// recognizes and skips (see persistSafety.ts).
export const partializeAppState = (
  state: AppState | null | undefined
): Partial<AppState> => {
  // Add safety check to prevent errors during hydration
  if (!state || typeof state !== 'object') {
    console.error(
      'Invalid state during partialize; skipping persist so stored data stays intact'
    );
    return null as unknown as Partial<AppState>;
  }

  try {
    return {
      projects: state.projects || initialState.projects,
      activeProjectId: state.activeProjectId ?? initialState.activeProjectId,
      isDarkMode: state.isDarkMode ?? initialState.isDarkMode,
      themeColor: state.themeColor || initialState.themeColor,
      quickLinks: state.quickLinks || initialState.quickLinks,
      notes: Array.isArray(state.notes) ? state.notes : initialState.notes,
      todos: state.todos || initialState.todos,
      // Enhanced task management persistence
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      taskTemplates: Array.isArray(state.taskTemplates)
        ? state.taskTemplates
        : [],
      taskViewSettings:
        state.taskViewSettings || initializeTaskState().taskViewSettings,
      taskStats: state.taskStats || initializeTaskState().taskStats,
      pomodoroSessions: Array.isArray(state.pomodoroSessions)
        ? state.pomodoroSessions
        : [],
      activeTaskId: state.activeTaskId ?? null,
      activePomodoroSession: state.activePomodoroSession ?? null,
      activeView: state.activeView || initialState.activeView,
      // Persist search & sort preferences (cleanup-and-regression-tests §4.2)
      searchFilters: state.searchFilters || initialState.searchFilters,
      sortOption: state.sortOption || initialState.sortOption,
      tabManagerRootFolderId:
        state.tabManagerRootFolderId ?? initialState.tabManagerRootFolderId,
      // Persist right panel state
      isRightContentPanelOpen:
        state.isRightContentPanelOpen ?? initialState.isRightContentPanelOpen,
      activeVerticalTabId:
        state.activeVerticalTabId ?? initialState.activeVerticalTabId,
      // Persist sidebar state
      isSidebarOpen: state.isSidebarOpen ?? initialState.isSidebarOpen,
      // Persist onboarding completion so the wizard shows only once.
      hasCompletedOnboarding:
        state.hasCompletedOnboarding ?? initialState.hasCompletedOnboarding,
      // Persist cloud sync config/account/cursors (token lives in its own
      // chrome.storage.local key via authStorage, not in the store).
      cloudSync: state.cloudSync ?? initialState.cloudSync,
    };
  } catch (error) {
    console.error(
      'Error during state partialize; skipping persist so stored data stays intact:',
      error
    );
    return null as unknown as Partial<AppState>;
  }
};

// ---------------------------------------------------------------------------
// One-time onboarding migration marker (fix-cross-context-data-loss §6)
// ---------------------------------------------------------------------------

/**
 * Separate `chrome.storage.local` key recording the one-time decision about
 * whether a user is an existing/upgrading user or a fresh install. Written
 * exactly once (on the first evaluation) and never revisited:
 *
 *  - `'upgrading'` — storage predated first-run onboarding (non-default
 *    persisted content): the wizard is never auto-shown for this user.
 *  - `'fresh'` — no/only-default content persisted: the wizard auto-opens
 *    whenever `hasCompletedOnboarding` is still false (i.e. it re-shows on
 *    every launch until the user completes or skips it).
 */
export const ONBOARDING_MIGRATION_STORAGE_KEY =
  'tab-manager-onboarding-migration';

export interface OnboardingMigrationDecision {
  /** True when persisted storage predates first-run onboarding. */
  upgrading: boolean;
}

const ENTITY_KEYS_WITH_DEFAULTS = [
  'projects',
  'notes',
  'todos',
  'tasks',
  'quickLinks',
  'taskTemplates',
  'pomodoroSessions',
] as const;

/**
 * True when the persisted state blob shows REAL prior usage. Defaults ship
 * deterministic mock content (`initialState`), and the first store write
 * persists exactly those defaults — so "non-empty" means "differs from the
 * deterministic defaults" (or the flag was explicitly completed elsewhere),
 * NOT merely "a blob exists" or "projects is a non-empty array".
 */
const hasNonDefaultPersistedContent = (raw: unknown): boolean => {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  try {
    const envelope = JSON.parse(raw) as {
      state?: Record<string, unknown> | null;
    };
    const persistedState = envelope?.state;
    if (!persistedState || typeof persistedState !== 'object') return false;

    // Explicit completion anywhere is definitive.
    if (persistedState.hasCompletedOnboarding === true) return true;

    const defaults = initialState as unknown as Record<string, unknown>;
    for (const key of ENTITY_KEYS_WITH_DEFAULTS) {
      const persisted = persistedState[key];
      if (!Array.isArray(persisted)) continue;
      // A fresh install persists exactly the deterministic defaults; any
      // difference (created, edited, or deleted content) means prior usage —
      // a user who deleted all the mock content is still an existing user.
      if (JSON.stringify(persisted) !== JSON.stringify(defaults[key] ?? [])) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.warn(
      'Could not inspect persisted state for onboarding migration:',
      error
    );
    return false;
  }
};

const decideOnboardingMigration =
  async (): Promise<OnboardingMigrationDecision> => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        // Non-extension context: nothing was ever persisted; behave fresh.
        return { upgrading: false };
      }

      const marker = await chrome.storage.local.get(
        ONBOARDING_MIGRATION_STORAGE_KEY
      );
      if (marker && marker[ONBOARDING_MIGRATION_STORAGE_KEY] !== undefined) {
        // The decision was made in a previous session — never revisit it.
        return {
          upgrading: marker[ONBOARDING_MIGRATION_STORAGE_KEY] === 'upgrading',
        };
      }

      const stored = await chrome.storage.local.get(APP_STATE_STORAGE_KEY);
      const upgrading = hasNonDefaultPersistedContent(
        stored?.[APP_STATE_STORAGE_KEY]
      );

      // Write-once: the classification is recorded so no later session (with
      // content the user created meanwhile) re-classifies them.
      await chrome.storage.local.set({
        [ONBOARDING_MIGRATION_STORAGE_KEY]: upgrading ? 'upgrading' : 'fresh',
      });
      return { upgrading };
    } catch (error) {
      console.error('Error resolving onboarding migration:', error);
      // Fail open: a genuinely new user must still see the wizard.
      return { upgrading: false };
    }
  };

let onboardingMigrationDecision: Promise<OnboardingMigrationDecision> | null =
  null;

/**
 * Resolve the one-time onboarding migration decision. Runs (at most) once per
 * page session — the decision is cached, so a re-mounted AppClient never
 * re-decides. Resolves `{ upgrading: false }` on any storage failure.
 */
export const resolveOnboardingMigration =
  (): Promise<OnboardingMigrationDecision> => {
    if (!onboardingMigrationDecision) {
      onboardingMigrationDecision = decideOnboardingMigration();
    }
    return onboardingMigrationDecision;
  };

/** Test hook: forget the cached decision (the storage marker is untouched). */
export const resetOnboardingMigrationForTests = (): void => {
  onboardingMigrationDecision = null;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSearchFilters: (filters) =>
        set((state) => ({
          searchFilters: { ...state.searchFilters, ...filters },
        })),
      setTabManagerRootFolderId: (id: string | null) =>
        set({ tabManagerRootFolderId: id }),
      setSortOption: (option) => set({ sortOption: option }),
      setThemeColor: (color) => set({ themeColor: color }),
      // Combine all actions
      ...createUIActions(set, get),
      ...createProjectActions(set, get),
      ...createCollectionActions(set, get),
      ...createLinkActions(set, get),
      ...createDragDropActions(set, get),
      ...createSidebarActions(set, get),
      ...createNoteActions(set, get),
      ...createTaskActions(set, get),
      ...createCloudSyncActions(set, get),
      // Add hydration control method
      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: 'tab-manager-storage',
      // Bumped for per-project scoping: notes/todos/tasks now carry projectId.
      // Zustand calls `migrate` whenever the stored snapshot's numeric version
      // differs from `version` below — and if no migrate is provided it logs an
      // error and DISCARDS the stored state (resetting to initial mock data).
      // Pass the snapshot through untouched; the per-project `projectId`
      // stamping is handled idempotently in `merge`, so the version bump itself
      // needs no transformation here.
      version: 1,
      migrate: (persistedState) => persistedState,
      storage: createJSONStorage(() => persistSafeStorageAdapter, {
        reviver: (key, value) => {
          if (
            (key === 'startTime' ||
              key === 'endTime' ||
              key === 'dueDate' ||
              key === 'createdAt' ||
              key === 'updatedAt' ||
              key === 'completedAt') &&
            typeof value === 'string'
          ) {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              return date;
            }
          }
          return value;
        },
      }),
      // Returns null on failure (see partializeAppState above) — the safe
      // storage adapter then skips the write instead of wiping stored data.
      partialize: partializeAppState,
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate state from storage:', error);
        }

        // For Chrome extensions, execute immediately for faster loading
        if (typeof window !== 'undefined') {
          try {
            const store = useAppStore.getState();
            if (store && typeof store === 'object' && store.setHasHydrated) {
              store.setHasHydrated(true);
            } else {
              console.warn(
                'Store or setHasHydrated method not available during hydration'
              );
            }

            // Apply theme immediately for faster visual feedback
            if (state?.isDarkMode === true) {
              document.documentElement.classList.add('dark');
            } else if (state?.isDarkMode === false) {
              document.documentElement.classList.remove('dark');
            }
          } catch (error) {
            console.warn('Error during hydration callback:', error);
            // Fallback: use requestAnimationFrame if immediate execution fails
            requestAnimationFrame(() => {
              try {
                const store = useAppStore.getState();
                if (
                  store &&
                  typeof store === 'object' &&
                  store.setHasHydrated
                ) {
                  store.setHasHydrated(true);
                }
              } catch (fallbackError) {
                console.warn('Fallback hydration also failed:', fallbackError);
              }
            });
          }
        }
      },
      // Add merge function to handle state merging safely
      merge: mergeAppState,
    }
  )
);

// Selector hooks for convenience. Selectors are honest: a throwing selector
// propagates to the nearest error boundary instead of being swallowed with a
// fallback value (see ui-resilience spec).
export const useActiveProject = () => {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const projects = useAppStore((state) => state.projects);
  return projects.find((p) => p.id === activeProjectId) || null;
};

export const useEditingCollection = () => {
  const activeProject = useActiveProject();
  const editingCollectionId = useAppStore((state) => state.editingCollectionId);
  if (!activeProject || !editingCollectionId) return null;
  return (
    activeProject.collections.find((c) => c.id === editingCollectionId) || null
  );
};

// Re-export types and constants for convenience
export type { AppState, ActiveViewType } from './types';

// ---------------------------------------------------------------------------
// Cross-context rehydration (fix-cross-context-data-loss §1.4)
//
// Every context (popup, newtab, service worker) subscribes to
// chrome.storage.onChanged for the app-state blob. When ANOTHER context
// persists, storage.ts's subscription ignores our own writes by generation
// and, after a 500 ms trailing debounce, rehydrates here — through `merge`
// (mergeAppState), which unions entities by id instead of replacing arrays
// wholesale. The rehydrate's persist write-back publishes any local-only
// entities to storage; identical-content write-backs are skipped by the
// storage wrapper so contexts cannot ping-pong.
//
// The `typeof` guard keeps this safe under test doubles that mock
// @/stores/storage with only `chromeStorageApi` (see storeWrapper.test.tsx).
// ---------------------------------------------------------------------------
if (
  typeof subscribeToStorageChanges === 'function' &&
  typeof chrome !== 'undefined' &&
  !!chrome.storage?.onChanged
) {
  subscribeToStorageChanges({
    onExternalChange: () => {
      void Promise.resolve(useAppStore.persist.rehydrate()).catch(
        () => undefined
      );
    },
  });
}
