'use client';

import { useEffect } from 'react';
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
import AddProjectModal from './modals/AddProjectModal';
import AddCollectionModal from './modals/AddCollectionModal';
import AddLinkModal from './modals/AddLinkModal';
import EditLinkModal from './modals/EditLinkModal';
import { cn } from '@/lib/utils';

export default function AppClient() {
  const isDarkMode = useIsDarkMode();
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();
  const _hasHydrated = useHasHydrated();
  const setActiveProject = useSetActiveProject();

  const isRightContentPanelOpen = useAppStoreWithDefaults(
    (state) => state.isRightContentPanelOpen,
    false
  );
  const initializeTabManagerRootFolder = useAppStoreWithDefaults(
    (state) => state.initializeTabManagerRootFolder,
    () => {}
  );

  useEffect(() => {
    // Call initializeTabManagerRootFolder after hydration, but only once
    if (_hasHydrated) {
      // Add a flag to prevent multiple initializations
      const hasInitialized = sessionStorage.getItem('tabManagerInitialized');
      if (!hasInitialized) {
        sessionStorage.setItem('tabManagerInitialized', 'true');
        initializeTabManagerRootFolder();
      }
    }
  }, [_hasHydrated, initializeTabManagerRootFolder]);

  useEffect(() => {
    // Only apply theme changes after hydration to prevent errors
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
              'flex-1 flex flex-col h-full overflow-y-auto transition-all duration-300 ease-in-out w-full'
            )}
          >
            <main className='flex-1 w-full'>
              <MainContentArea />
            </main>
          </div>
          <div className='h-full z-30'>
            <VerticalRightTabsBar />
          </div>
          {isRightContentPanelOpen && <RightContentPanel />}
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
