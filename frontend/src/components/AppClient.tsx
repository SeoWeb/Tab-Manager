'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import LeftSidebar from '@/components/left-sidebar/LeftSidebar';
import MainContentArea from '@/components/main-content/MainContentArea';
import SettingsView from '@/components/views/SettingsView';
import TasksView from '@/components/views/TasksView';
import { GlobalDragDropProvider } from '@/components/drag-drop/GlobalDragDropProvider';
import {
  useProjects,
  useActiveProjectId,
  useIsDarkMode,
  useHasHydrated,
  useSetActiveProject,
  useAppStoreWithDefaults,
} from '@/hooks/useAppStoreWithDefaults';
import AddProjectModal from '@/components/modals/AddProjectModal';
import AddCollectionModal from '@/components/modals/AddCollectionModal';
import AddLinkModal from '@/components/modals/AddLinkModal';
import EditLinkModal from '@/components/modals/EditLinkModal';
import { cn } from '@/lib/utils';
import { preloadCriticalResources } from '@/lib/performanceUtils';
import { syncAllCloudProjects } from '@/lib/cloudflareSync/orchestrator';

/**
 * Web AppClient.
 *
 * Mirrors the extension's AppClient render tree and theme/auto-select effects,
 * but drops the three extension-only initialization paths:
 *   - `bookmarkStorage.initialize()` — skipped so `tabManagerRootFolderId`
 *     stays `null`, which (via the truthiness guards in the store actions)
 *     silently skips all bookmark CRUD. There are no Chrome bookmarks on web.
 *   - `checkForSessionRestore()` / `startAutoSaveMonitoring()` — Chrome tab
 *     sessions have no web equivalent; the Sessions panel shows a notice.
 *   - `useChromeTabsMonitoring()` — no `chrome.tabs` events; the Chrome Tabs
 *     panel shows a notice.
 *
 * In their place it wires the background-sync cadence the extension ran via
 * `chrome.alarms` in its service worker. The extension's `backgroundSyncAll`
 * reads/writes raw `chrome.storage` and so is inert in a browser; instead we
 * drive the live in-app sync (`syncAllCloudProjects`, which operates on the
 * mounted Zustand store) on a 5-minute `setInterval` — the same cadence the
 * service worker used.
 */
export default function AppClient() {
  const isDarkMode = useIsDarkMode();
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();
  const _hasHydrated = useHasHydrated();
  const setActiveProject = useSetActiveProject();

  // Preload critical resources for better performance
  useEffect(() => {
    preloadCriticalResources();
  }, []);

  // In-app background-sync cadence (replaces the service-worker `chrome.alarms`).
  useEffect(() => {
    const intervalMs = 5 * 60 * 1000; // 5 minutes
    const id = setInterval(() => {
      void syncAllCloudProjects();
    }, intervalMs);
    return () => clearInterval(id);
  }, []);

  const activeView = useAppStoreWithDefaults(
    (state) => state.activeView,
    'projectDetail'
  );
  const detectSystemTheme = useAppStoreWithDefaults(
    (state) => state.detectSystemTheme,
    () => () => {}
  );

  useEffect(() => {
    // Initialize theme only once after hydration
    if (_hasHydrated) {
      const state = useAppStore.getState();

      // Check if theme preference was loaded from storage
      if (!state._themeFromStorage) {
        // No stored preference, use system theme
        const cleanup = detectSystemTheme();
        return cleanup;
      } else {
        // Apply stored theme preference
        if (state.isDarkMode) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    }
  }, [_hasHydrated, detectSystemTheme]);

  useEffect(() => {
    // Apply theme changes when isDarkMode state changes (from user toggle)
    if (_hasHydrated) {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode, _hasHydrated]);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0].id);
    } else if (
      activeProjectId &&
      !projects.find((p) => p.id === activeProjectId) &&
      projects.length > 0
    ) {
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      setActiveProject(null);
    }
  }, [projects, activeProjectId, setActiveProject]);

  return (
    <>
      <GlobalDragDropProvider>
        <div className='flex h-screen bg-background w-full'>
          <LeftSidebar />
          <div
            className={cn(
              'flex-1 flex flex-col h-full overflow-y-auto transition-all duration-300 ease-in-out'
            )}
          >
            <main className='flex-1 w-full'>
              {activeView === 'settings' ? (
                <SettingsView />
              ) : activeView === 'tasks' ? (
                <TasksView showHeader={true} />
              ) : (
                <MainContentArea />
              )}
            </main>
          </div>
        </div>
      </GlobalDragDropProvider>
      <AddProjectModal>
        <div />
      </AddProjectModal>
      <AddCollectionModal />
      <AddLinkModal />
      <EditLinkModal />
    </>
  );
}
