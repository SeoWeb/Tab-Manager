
"use client";

import { useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarInset } from "@/components/ui/sidebar";
import LeftSidebar from "@/components/left-sidebar/LeftSidebar";
import MainContentArea from "@/components/main-content/MainContentArea";
// import RightSidePanel from "@/components/right-panel/RightSidePanel"; // Old panel
import VerticalRightTabsBar from "@/components/right-vertical-tabs/VerticalRightTabsBar"; // New
import RightContentPanel from "@/components/right-vertical-tabs/RightContentPanel"; // New
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
      <div className="flex h-screen bg-background">
        <LeftSidebar />
        <SidebarInset className={cn("flex flex-1 overflow-hidden")}> {/* SidebarInset now wraps the main area + content panel */}
            <MainContentArea className="flex-grow" /> {/* Main content takes available space */}
            {isRightContentPanelOpen && <RightContentPanel />} {/* Content panel slides in */}
        </SidebarInset>
        <VerticalRightTabsBar /> {/* Vertical tabs always visible on the far right */}
      </div>
      <AddProjectModal />
      <AddCollectionModal />
      <AddLinkModal />
    </SidebarProvider>
  );
}
