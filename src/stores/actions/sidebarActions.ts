import type { AppState } from '../types';
import { chromeStorageApi } from '../storage';

const SIDEBAR_STORAGE_KEY = 'sidebar-state';

export const createSidebarActions = (
  set: (fn: (state: AppState) => Partial<AppState>) => void,
  get: () => AppState
) => ({
  setSidebarOpen: (value: boolean | ((prev: boolean) => boolean)) => {
    const currentState = get();
    const newState =
      typeof value === 'function' ? value(currentState.isSidebarOpen) : value;

    set((state) => ({ ...state, isSidebarOpen: newState }));

    // Save to Chrome storage asynchronously
    try {
      chromeStorageApi.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(newState));
    } catch (error) {
      console.warn('Failed to save sidebar state to storage:', error);
    }
  },

  toggleSidebar: () => {
    const currentState = get();
    const newState = !currentState.isSidebarOpen;

    set((state) => ({ ...state, isSidebarOpen: newState }));

    // Save to Chrome storage asynchronously
    try {
      chromeStorageApi.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(newState));
    } catch (error) {
      console.warn('Failed to save sidebar state to storage:', error);
    }
  },

  setSidebarLoaded: (loaded: boolean) => {
    set((state) => ({ ...state, isSidebarLoaded: loaded }));
  },

  // Initialize sidebar state from storage
  initializeSidebarState: async (defaultOpen: boolean = false) => {
    try {
      const storedState = await chromeStorageApi.getItem(SIDEBAR_STORAGE_KEY);
      const sidebarOpen =
        storedState !== null ? JSON.parse(storedState) : defaultOpen;

      set((state) => ({
        ...state,
        isSidebarOpen: sidebarOpen,
        isSidebarLoaded: true,
      }));
    } catch (error) {
      console.warn('Failed to load sidebar state from storage:', error);
      set((state) => ({
        ...state,
        isSidebarOpen: defaultOpen,
        isSidebarLoaded: true,
      }));
    }
  },
});
