
"use client";

import { useEffect } from 'react';
import { SidebarProvider } from "@/components/ui/sidebar";
import LeftSidebar from "@/components/left-sidebar/LeftSidebar";
import MainContentArea from "@/components/main-content/MainContentArea";
import VerticalRightTabsBar from "@/components/right-vertical-tabs/VerticalRightTabsBar";
import RightContentPanel from "@/components/right-vertical-tabs/RightContentPanel";
import { useAppStore } from "@/stores/appStore";
import AddProjectModal from './modals/AddProjectModal';
import AddCollectionModal from './modals/AddCollectionModal';
import AddLinkModal from './modals/AddLinkModal';
import { cn } from '@/lib/utils';

export default function AppClient() {
  const { isDarkMode, activeProjectId, isRightContentPanelOpen } = useAppStore();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  const projects = useAppStore(state => state.projects);
  const setActiveProject = useAppStore(state => state.setActiveProject);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0].id);
    } else if (activeProjectId && !projects.find(p => p.id === activeProjectId) && projects.length > 0) {
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      setActiveProject(null);
    }
  }, [projects, activeProjectId, setActiveProject]);


  return (
    <SidebarProvider defaultOpen={true}>
      {/* SidebarProvider's root div is already 'flex' */}
      {/* This inner div will be the main flex container for content if LeftSidebar is out of flow */}
      <div className="h-screen bg-background"> {/* This div is the child of SidebarProvider's flex div */}
        
        {/* Left Sidebar - Now fixed via its own internal className, so it's an overlay */}
        <LeftSidebar />

        {/* Main Content Wrapper - Takes full width as LeftSidebar is out of normal flow */}
        {/* This div becomes the primary content area, effectively flex-1 within SidebarProvider's root flex */}
        <div className={cn("flex flex-1 w-full h-full overflow-hidden")}>
            <MainContentArea className="flex-grow" />
            {isRightContentPanelOpen && <RightContentPanel />}
        </div>

        {/* Vertical Right Tabs Bar - Positioned as an overlay */}
        <div className="fixed right-0 top-0 h-full z-10">
          <VerticalRightTabsBar />
        </div>
      </div>
      <AddProjectModal />
      <AddCollectionModal />
      <AddLinkModal />
    </SidebarProvider>
  );
}

