import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { chromeStorageApi } from './storage';
import { initialProjects, mockChromeWindows } from './mockData';
import { createProjectActions } from './actions/projectActions';
import { createCollectionActions } from './actions/collectionActions';
import { createLinkActions } from './actions/linkActions';
import { createDragDropActions } from './actions/dragDropActions';
import { createUIActions } from './actions/uiActions';
import { createSidebarActions } from './actions/sidebarActions';

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
  chromeWindows: mockChromeWindows,
  quickLinks: [],
  notes: '',
  todos: [],
  isAddProjectModalOpen: false,
  isAddCollectionModalOpen: false,
  isAddLinkModalOpen: false,
  isEditLinkModalOpen: false,
  editingCollectionIdForLink: null,
  editingCollectionId: null,
  editingLinkId: null,
  tabManagerRootFolderId: null,
  _hasHydrated: false,
  _themeFromStorage: false,
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
      ...createDragDropActions(set),
      ...createSidebarActions(set, get),
    }),
    {
      name: 'tab-manager-storage',
      storage: createJSONStorage(() => chromeStorageApi),
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
            notes: state.notes || initialState.notes,
            todos: state.todos || initialState.todos,
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

        // Use setTimeout to ensure the store is fully initialized
        setTimeout(() => {
          try {
            const store = useAppStore.getState();
            if (store && typeof store === 'object' && store.setHasHydrated) {
              store.setHasHydrated(true);
            } else {
              console.warn(
                'Store or setHasHydrated method not available during hydration'
              );
            }

            // Apply theme on load based on the rehydrated state
            if (state?.isDarkMode === true) {
              document.documentElement.classList.add('dark');
            } else if (state?.isDarkMode === false) {
              document.documentElement.classList.remove('dark');
            }
          } catch (error) {
            console.warn('Error during hydration callback:', error);
          }
        }, 0);
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
    (state) => state.editingCollectionIdForLink,
    null
  );
  if (!activeProject || !editingCollectionId) return null;
  return (
    activeProject.collections.find((c) => c.id === editingCollectionId) || null
  );
};

// Re-export types and constants for convenience
export type { AppState, ActiveViewType } from './types';
