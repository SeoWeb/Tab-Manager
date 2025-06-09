'use client';

import { useEffect } from 'react';
// import { useSidebar } from '@/components/ui/sidebar'; // Import useSidebar
import LeftSidebar from '@/components/left-sidebar/LeftSidebar';
import MainContentArea from '@/components/main-content/MainContentArea';
import VerticalRightTabsBar from '@/components/right-vertical-tabs/VerticalRightTabsBar';
import RightContentPanel from '@/components/right-vertical-tabs/RightContentPanel';
import { useAppStore } from '@/stores/appStore';
import AddProjectModal from './modals/AddProjectModal';
import AddCollectionModal from './modals/AddCollectionModal';
import AddLinkModal from './modals/AddLinkModal';
import { cn } from '@/lib/utils';

export default function AppClient() {
  const {
    isDarkMode,
    activeProjectId,
    isRightContentPanelOpen,
    initializeTabManagerRootFolder, // Get the action
    _hasHydrated, // Get hydration status
  } = useAppStore((state) => ({
    isDarkMode: state.isDarkMode,
    activeProjectId: state.activeProjectId,
    isRightContentPanelOpen: state.isRightContentPanelOpen,
    initializeTabManagerRootFolder: state.initializeTabManagerRootFolder,
    _hasHydrated: state._hasHydrated,
  }));
  // const { open: sidebarOpen, isMobile } = useSidebar(); // Get sidebar state and mobile status

  useEffect(() => {
    // Call initializeTabManagerRootFolder after hydration
    if (_hasHydrated) {
      initializeTabManagerRootFolder();
    }

    // This is a temporary workaround to ensure the root folder is initialized.
    // A better solution would be to use a dedicated initialization state.
    if (_hasHydrated) {
      initializeTabManagerRootFolder();
    }

    return () => {
      // No cleanup needed
    };
  }, [_hasHydrated, initializeTabManagerRootFolder]); // Add dependencies

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const projects = useAppStore((state) => state.projects);
  const setActiveProject = useAppStore((state) => state.setActiveProject);

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
      <AddProjectModal>
        <></>
      </AddProjectModal>
      <AddCollectionModal />
      <AddLinkModal />
    </>
  );
}
