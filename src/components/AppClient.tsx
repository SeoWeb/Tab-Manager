'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import LeftSidebar from '@/components/left-sidebar/LeftSidebar';
import MainContentArea from '@/components/main-content/MainContentArea';
import SettingsView from '@/components/views/SettingsView';
import VerticalRightTabsBar from '@/components/right-vertical-tabs/VerticalRightTabsBar';
import RightContentPanel from '@/components/right-vertical-tabs/RightContentPanel';
import { GlobalDragDropProvider } from '@/components/drag-drop/GlobalDragDropProvider';
import {
  useProjects,
  useActiveProjectId,
  useIsDarkMode,
  useHasHydrated,
  useSetActiveProject,
  useAppStoreWithDefaults,
} from '@/hooks/useAppStoreWithDefaults';
import AddProjectModal from './modals/AddProjectModal';
import AddCollectionModal from './modals/AddCollectionModal';
import AddLinkModal from './modals/AddLinkModal';
import EditLinkModal from './modals/EditLinkModal';
import { cn } from '@/lib/utils';
import { useChromeTabsMonitoring } from '@/hooks/useChromeTabsMonitoring';
import {
  startAutoSaveMonitoring,
  checkForSessionRestore,
} from '@/lib/tabSessionService';

export default function AppClient() {
  const isDarkMode = useIsDarkMode();
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();
  const _hasHydrated = useHasHydrated();
  const setActiveProject = useSetActiveProject();

  // Initialize Chrome tabs monitoring
  useChromeTabsMonitoring();

  const isRightContentPanelOpen = useAppStoreWithDefaults(
    (state) => state.isRightContentPanelOpen,
    false
  );
  const activeView = useAppStoreWithDefaults(
    (state) => state.activeView,
    'projectDetail'
  );
  const detectSystemTheme = useAppStoreWithDefaults(
    (state) => state.detectSystemTheme,
    () => () => {}
  );

  useEffect(() => {
    const init = async () => {
      if (_hasHydrated) {
        const hasInitialized = sessionStorage.getItem('tabManagerInitialized');
        if (!hasInitialized) {
          sessionStorage.setItem('tabManagerInitialized', 'true');
          const { bookmarkStorage } = await import('@/lib/bookmarkStorage');
          const rootId = await bookmarkStorage.initialize();
          useAppStore.getState().setTabManagerRootFolderId(rootId);
        }
      }
    };
    init();
  }, [_hasHydrated]);

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

  // Initialize tab session monitoring and restore
  useEffect(() => {
    if (!_hasHydrated) return;

    let cleanup: (() => void) | null = null;

    const initTabSessions = async () => {
      try {
        // Check for session restore on startup
        await checkForSessionRestore();

        // Start auto-save monitoring
        cleanup = startAutoSaveMonitoring();
      } catch (error) {
        console.error('Error initializing tab sessions:', error);
      }
    };

    initTabSessions();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [_hasHydrated]);

  return (
    <>
      <GlobalDragDropProvider>
        <div className='flex h-screen bg-background w-full'>
          <LeftSidebar />
          <div
            className={cn(
              'flex-1 flex flex-col h-full overflow-y-auto transition-all duration-300 ease-in-out mr-0'
            )}
          >
            <main className='flex-1 w-full'>
              {activeView === 'settings' ? (
                <SettingsView />
              ) : (
                <MainContentArea />
              )}
            </main>
          </div>
          {isRightContentPanelOpen && (
            <div className='h-full z-20'>
              <RightContentPanel />
            </div>
          )}
          <div className='h-full z-30'>
            <VerticalRightTabsBar />
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
