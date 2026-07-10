import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { chromeStorageApi } from '@/stores/storage';
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

// Create initial state as a constant to ensure consistency
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
  tabManagerRootFolderId: null,
  cloudSync: {
    enabled: false,
    status: 'idle' as const,
    lastSyncedAt: null,
    lastError: null,
    pendingMutationCount: 0,
    account: null,
    apiBaseUrl: 'https://tab-manager-backend.ww0.dev',
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
      storage: createJSONStorage(() => chromeStorageApi, {
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
      partialize: (state) => {
        // Add safety check to prevent errors during hydration
        if (!state || typeof state !== 'object') {
          console.warn(
            'Invalid state during partialize, returning empty object'
          );
          return {};
        }

        try {
          return {
            projects: state.projects || initialState.projects,
            activeProjectId:
              state.activeProjectId ?? initialState.activeProjectId,
            isDarkMode: state.isDarkMode ?? initialState.isDarkMode,
            themeColor: state.themeColor || initialState.themeColor,
            quickLinks: state.quickLinks || initialState.quickLinks,
            notes: Array.isArray(state.notes)
              ? state.notes
              : initialState.notes,
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
            tabManagerRootFolderId:
              state.tabManagerRootFolderId ??
              initialState.tabManagerRootFolderId,
            // Persist right panel state
            isRightContentPanelOpen:
              state.isRightContentPanelOpen ??
              initialState.isRightContentPanelOpen,
            activeVerticalTabId:
              state.activeVerticalTabId ?? initialState.activeVerticalTabId,
            // Persist sidebar state
            isSidebarOpen: state.isSidebarOpen ?? initialState.isSidebarOpen,
            // Persist cloud sync config/account/cursors (token lives in its own
            // chrome.storage.local key via authStorage, not in the store).
            cloudSync: state.cloudSync ?? initialState.cloudSync,
          };
        } catch (error) {
          console.error('Error during state partialize:', error);
          return {};
        }
      },
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
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          console.warn('Invalid persisted state, using current state');
          return {
            ...currentState,
            _themeFromStorage: false, // Mark that no theme was loaded from storage
          };
        }

        try {
          const persistedStateTyped = persistedState as Partial<AppState>;
          const hasStoredTheme = 'isDarkMode' in persistedStateTyped;

          // Phase A per-project migration: assign the owning project to any
          // pre-existing notes/todos/tasks that predate `projectId`. This runs
          // in `merge` on every rehydrate (idempotent) — see the version note
          // above for why a version-gated `migrate` can't be relied on here.
          // Items with no resolvable project stay unscoped and surface only via
          // the global Tasks route as a safety net.
          const ownerProjectId =
            persistedStateTyped.activeProjectId ??
            persistedStateTyped.projects?.[0]?.id ??
            null;
          const stampProjectId = <T extends { projectId?: string }>(
            item: T
          ): T => {
            if (item.projectId) return item;
            if (ownerProjectId == null) return item;
            return { ...item, projectId: ownerProjectId };
          };

          const mergedState = {
            ...currentState,
            ...persistedState,
            // Mark whether theme was loaded from storage
            _themeFromStorage: hasStoredTheme,
            // Ensure critical properties are never undefined
            projects: persistedStateTyped.projects || currentState.projects,
            isDarkMode: hasStoredTheme
              ? (persistedStateTyped.isDarkMode ?? currentState.isDarkMode)
              : currentState.isDarkMode,
            activeView:
              persistedStateTyped.activeView || currentState.activeView,
            // Ensure modal states are properly initialized
            isAddProjectModalOpen:
              persistedStateTyped.isAddProjectModalOpen ??
              currentState.isAddProjectModalOpen,
            isAddCollectionModalOpen:
              persistedStateTyped.isAddCollectionModalOpen ??
              currentState.isAddCollectionModalOpen,
            isAddLinkModalOpen:
              persistedStateTyped.isAddLinkModalOpen ??
              currentState.isAddLinkModalOpen,
            isEditLinkModalOpen:
              persistedStateTyped.isEditLinkModalOpen ??
              currentState.isEditLinkModalOpen,
            // Ensure sidebar state is properly initialized
            isSidebarOpen:
              persistedStateTyped.isSidebarOpen ?? currentState.isSidebarOpen,
            isSidebarLoaded:
              persistedStateTyped.isSidebarLoaded ??
              currentState.isSidebarLoaded,
            // Migrate notes from string to array format (and stamp projectId)
            notes: Array.isArray(persistedStateTyped.notes)
              ? persistedStateTyped.notes.map(stampProjectId)
              : currentState.notes,
            // Todos are preserved via the spread above; stamp projectId here
            todos: Array.isArray(persistedStateTyped.todos)
              ? persistedStateTyped.todos.map(stampProjectId)
              : currentState.todos,
            // Enhanced task management state merging (and stamp projectId)
            tasks: Array.isArray(persistedStateTyped.tasks)
              ? persistedStateTyped.tasks.map(stampProjectId)
              : currentState.tasks,
            taskTemplates: Array.isArray(persistedStateTyped.taskTemplates)
              ? persistedStateTyped.taskTemplates
              : currentState.taskTemplates,
            taskViewSettings:
              persistedStateTyped.taskViewSettings ||
              currentState.taskViewSettings,
            taskStats: persistedStateTyped.taskStats || currentState.taskStats,
            pomodoroSessions: Array.isArray(
              persistedStateTyped.pomodoroSessions
            )
              ? persistedStateTyped.pomodoroSessions
              : currentState.pomodoroSessions,
            activeTaskId:
              persistedStateTyped.activeTaskId ?? currentState.activeTaskId,
            activePomodoroSession:
              persistedStateTyped.activePomodoroSession ??
              currentState.activePomodoroSession,
            cloudSync: persistedStateTyped.cloudSync ?? currentState.cloudSync,
          };

          return mergedState;
        } catch (error) {
          console.error('Error merging state:', error);
          return {
            ...currentState,
            _themeFromStorage: false,
          };
        }
      },
    }
  )
);

// Safe selector that provides defaults for undefined state
export const useSafeAppStore = <T>(
  selector: (state: AppState) => T,
  defaultValue: T
): T => {
  return useAppStore((state) => {
    try {
      if (!state) return defaultValue;
      return selector(state);
    } catch {
      return defaultValue;
    }
  });
};

// Selector hooks for convenience
export const useActiveProject = () => {
  const activeProjectId = useSafeAppStore(
    (state) => state.activeProjectId,
    null
  );
  const projects = useSafeAppStore((state) => state.projects, []);
  return projects.find((p) => p.id === activeProjectId) || null;
};

export const useEditingCollection = () => {
  const activeProject = useActiveProject();
  const editingCollectionId = useSafeAppStore(
    (state) => state.editingCollectionId,
    null
  );
  if (!activeProject || !editingCollectionId) return null;
  return (
    activeProject.collections.find((c) => c.id === editingCollectionId) || null
  );
};

// Re-export types and constants for convenience
export type { AppState, ActiveViewType } from './types';
