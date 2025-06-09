"use client";

import { useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarInset } from "@/components/ui/sidebar";
import LeftSidebar from "@/components/left-sidebar/LeftSidebar";
import MainContentArea from "@/components/main-content/MainContentArea";
import RightSidePanel from "@/components/right-panel/RightSidePanel";
import { useAppStore } from "@/stores/appStore";
import AddProjectModal from './modals/AddProjectModal';
import AddCollectionModal from './modals/AddCollectionModal';
import AddLinkModal from './modals/AddLinkModal';

export default function AppClient() {
  const { isRightPanelOpen, isDarkMode, activeProjectId } = useAppStore();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  // Ensure there's always an active project if projects exist
  const projects = useAppStore(state => state.projects);
  const setActiveProject = useAppStore(state => state.setActiveProject);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0].id);
    } else if (activeProjectId && !projects.find(p => p.id === activeProjectId) && projects.length > 0) {
      // Active project was deleted, set to first available
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      // All projects deleted
      setActiveProject(null);
    }
  }, [projects, activeProjectId, setActiveProject]);


  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen bg-background">
        <LeftSidebar />
        <SidebarInset>
          <div className="flex flex-1 h-full overflow-hidden">
            <MainContentArea />
            {isRightPanelOpen && <RightSidePanel />}
          </div>
        </SidebarInset>
      </div>
      <AddProjectModal />
      <AddCollectionModal />
      <AddLinkModal />
    </SidebarProvider>
  );
}
