'use client';

import { useEffect } from 'react';
import { useSidebar } from '@/components/ui/sidebar'; // Import useSidebar
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
  const { open: sidebarOpen, isMobile } = useSidebar(); // Get sidebar state and mobile status

  useEffect(() => {
    // Call initializeTabManagerRootFolder after hydration
    if (_hasHydrated) {
      initializeTabManagerRootFolder();
    }

    const unsubscribe = useAppStore.subscribe(
      (state) => state._hasHydrated,
      (hydrated) => {
        if (hydrated) {
          initializeTabManagerRootFolder();
          unsubscribe();
        }
      }
    );

    return () => {
      unsubscribe();
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
      <div className='h-screen bg-background'>
        <LeftSidebar /> {/* This is fixed and overlays */}
        {/* Main Content Wrapper - Takes full width, with padding for the LeftSidebar */}
        <div
          className={cn(
            'flex flex-1 w-full h-full overflow-hidden transition-all duration-200 ease-linear',
            // Apply padding-left on md screens and up, based on sidebar state
            !isMobile && sidebarOpen && 'md:pl-[var(--sidebar-width)]', // 16rem by default
            !isMobile && !sidebarOpen && 'md:pl-[var(--sidebar-width-icon)]' // 3rem by default
          )}
        >
          <MainContentArea className='flex-grow' />
          {isRightContentPanelOpen && <RightContentPanel />}
        </div>
        {/* Vertical Right Tabs Bar - Positioned as an overlay */}
        <div className='fixed right-0 top-0 h-full z-10'>
          <VerticalRightTabsBar />
        </div>
      </div>
      <AddProjectModal />
      <AddCollectionModal />
      <AddLinkModal />
    </>
  );
}
