import { useAppStore } from '@/stores/appStore';
import type { AppState } from '@/stores/types';

/**
 * Direct pass-through to the store hook.
 *
 * Historically this helper wrapped selectors in try/catch with fallback
 * values to defend against `undefined` state; the store is now created
 * synchronously with fully-populated state and the UI renders only after
 * hydration, so those defenses were dead code that hid real selector bugs.
 * Per the ui-resilience spec ("Selector failures are honest"), a throwing
 * selector now propagates to the nearest error boundary.
 */
export function useAppStoreWithDefaults<T>(
  selector: (state: AppState) => T
): T {
  return useAppStore(selector);
}

// Convenience hooks — plain selectors (state fields and actions are always
// defined on the store, so no fallbacks are needed).
export const useProjects = () => useAppStore((state) => state.projects);

export const useActiveProjectId = () =>
  useAppStore((state) => state.activeProjectId);

export const useIsDarkMode = () => useAppStore((state) => state.isDarkMode);

export const useHasHydrated = () => useAppStore((state) => state._hasHydrated);

export const useToggleDarkMode = () =>
  useAppStore((state) => state.toggleDarkMode);

export const useSetActiveView = () =>
  useAppStore((state) => state.setActiveView);

export const useSetActiveProject = () =>
  useAppStore((state) => state.setActiveProject);

export const useAddProject = () => useAppStore((state) => state.addProject);

export const useActiveVerticalTabId = () =>
  useAppStore((state) => state.activeVerticalTabId);

export const useToggleRightContentPanel = () =>
  useAppStore((state) => state.toggleRightContentPanel);

export const useIsRightContentPanelOpen = () =>
  useAppStore((state) => state.isRightContentPanelOpen);
