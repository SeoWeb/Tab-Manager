import { useAppStore } from '@/stores/appStore';
import type { AppState } from '@/stores/types';

// Default values to prevent undefined errors
const defaultState: Partial<AppState> = {
  projects: [],
  activeProjectId: null,
  isDarkMode: false,
  activeView: 'projectDetail',
  isRightContentPanelOpen: false,
  activeVerticalTabId: null,
  quickLinks: [],
  notes: [],
  todos: [],
  chromeWindows: [],
  _hasHydrated: false,
  isAddProjectModalOpen: false,
  isAddCollectionModalOpen: false,
  isAddLinkModalOpen: false,
  isEditLinkModalOpen: false,
  editingCollectionIdForLink: null,
  editingCollectionId: null,
  editingLinkId: null,
  tabManagerRootFolderId: null,
};

export function useAppStoreWithDefaults<T>(
  selector: (state: AppState) => T,
  fallback?: T
): T {
  return useAppStore((state) => {
    // Enhanced safety checks
    if (!state || typeof state !== 'object') {
      console.warn(
        'Store state is undefined or invalid, using fallback. State:',
        state
      );
      if (fallback !== undefined) return fallback;

      // Try to apply selector to default state
      try {
        return selector(defaultState as AppState);
      } catch (error) {
        console.warn('Failed to apply selector to default state:', error);
        return fallback as T;
      }
    }

    try {
      const result = selector(state);
      // Additional check for undefined results
      if (result === undefined && fallback !== undefined) {
        console.warn(
          'Selector returned undefined, using fallback. Selector:',
          selector.toString()
        );
        return fallback;
      }
      return result;
    } catch (error) {
      console.warn(
        'Selector failed, using fallback:',
        error,
        'Selector:',
        selector.toString()
      );
      return fallback as T;
    }
  });
}

// Convenience hooks with safe defaults
export const useProjects = () =>
  useAppStoreWithDefaults((state) => state.projects, []);

export const useActiveProjectId = () =>
  useAppStoreWithDefaults((state) => state.activeProjectId, null);

export const useIsDarkMode = () =>
  useAppStoreWithDefaults((state) => state.isDarkMode, false);

export const useHasHydrated = () =>
  useAppStoreWithDefaults((state) => state._hasHydrated, false);

export const useToggleDarkMode = () =>
  useAppStoreWithDefaults(
    (state) => state.toggleDarkMode,
    () => {}
  );

export const useSetActiveView = () =>
  useAppStoreWithDefaults(
    (state) => state.setActiveView,
    () => {}
  );

export const useSetActiveProject = () =>
  useAppStoreWithDefaults(
    (state) => state.setActiveProject,
    () => {}
  );

export const useAddProject = () =>
  useAppStoreWithDefaults(
    (state) => state.addProject,
    () => {}
  );

export const useActiveVerticalTabId = () =>
  useAppStoreWithDefaults((state) => state.activeVerticalTabId, null);

export const useToggleRightContentPanel = () =>
  useAppStoreWithDefaults(
    (state) => state.toggleRightContentPanel,
    () => {}
  );

export const useIsRightContentPanelOpen = () =>
  useAppStoreWithDefaults((state) => state.isRightContentPanelOpen, false);
