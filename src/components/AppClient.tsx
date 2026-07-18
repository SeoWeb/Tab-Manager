'use client';

import { lazy, Suspense, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import LeftSidebar from '@/components/left-sidebar/LeftSidebar';
import MainContentArea from '@/components/main-content/MainContentArea';
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
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useChromeTabsMonitoring } from '@/hooks/useChromeTabsMonitoring';
import {
  deferUntilIdle,
  lazyImport,
  preloadCriticalResources,
} from '@/lib/performanceUtils';
import { reconcileAllCloudProjects } from '@/lib/cloudflareSync/orchestrator';

const SettingsView = lazy(() => import('@/components/views/SettingsView'));
const TasksView = lazy(() => import('@/components/views/TasksView'));
const AddProjectModal = lazy(() => import('./modals/AddProjectModal'));
const AddCollectionModal = lazy(() => import('./modals/AddCollectionModal'));
const AddLinkModal = lazy(() => import('./modals/AddLinkModal'));
const EditLinkModal = lazy(() => import('./modals/EditLinkModal'));
const OnboardingWizard = lazy(() => import('./onboarding/OnboardingWizard'));

export default function AppClient() {
  const isDarkMode = useIsDarkMode();
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();
  const _hasHydrated = useHasHydrated();
  const setActiveProject = useSetActiveProject();

  // Initialize Chrome tabs monitoring — no-op on the web (no chrome.tabs).
  useChromeTabsMonitoring();

  // Preload critical resources for better performance
  useEffect(() => {
    preloadCriticalResources();
  }, []);

  // Repair divergences on open/refresh (cloud-reconcile-snapshot). The background
  // service worker only reconciles on install/startup/alarm, which a plain page
  // refresh never triggers — so the open tab must kick one off itself. Run once
  // per page session after hydration; reconcile is a no-op when cloud is off.
  useEffect(() => {
    if (!_hasHydrated) return;
    if (sessionStorage.getItem('tabManagerReconciled')) return;
    sessionStorage.setItem('tabManagerReconciled', 'true');
    if (useAppStore.getState().cloudSync.enabled) {
      void reconcileAllCloudProjects();
    }
  }, [_hasHydrated]);

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
          // Use performance utility to defer bookmark initialization
          deferUntilIdle(async () => {
            try {
              const { bookmarkStorage } = await lazyImport(
                () => import('@/lib/bookmarkStorage'),
                'bookmarkStorage'
              );
              const rootId = await bookmarkStorage.initialize();
              useAppStore.getState().setTabManagerRootFolderId(rootId);
            } catch (error) {
              console.error('Error initializing bookmark storage:', error);
            }
          });
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
    // Auto-open the onboarding wizard after hydration for fresh users.
    // Re-shows on reloads until explicitly completed, per design D3.
    if (!_hasHydrated) return;
    const state = useAppStore.getState();
    if (!state.hasCompletedOnboarding) {
      state.openOnboarding();
    }
  }, [_hasHydrated]);

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
        // Use performance utility to defer tab session operations
        deferUntilIdle(async () => {
          try {
            const { checkForSessionRestore, startAutoSaveMonitoring } =
              await lazyImport(
                () => import('@/lib/tabSessionService'),
                'tabSessionService'
              );

            // Check for session restore on startup
            await checkForSessionRestore();

            // Start auto-save monitoring
            cleanup = startAutoSaveMonitoring();
          } catch (error) {
            console.error('Error initializing tab sessions:', error);
          }
        });
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
                <Suspense fallback={<Skeleton className='h-full w-full' />}>
                  <SettingsView />
                </Suspense>
              ) : activeView === 'tasks' ? (
                <Suspense fallback={<Skeleton className='h-full w-full' />}>
                  <TasksView showHeader={true} />
                </Suspense>
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
      <Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <AddProjectModal>
          <div />
        </AddProjectModal>
      </Suspense>
      <Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <AddCollectionModal />
      </Suspense>
      <Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <AddLinkModal />
      </Suspense>
      <Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <EditLinkModal />
      </Suspense>
      <Suspense fallback={null}>
        <OnboardingWizard />
      </Suspense>
    </>
  );
}
