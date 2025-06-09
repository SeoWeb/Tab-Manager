
"use client";

import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter } from "@/components/ui/sidebar";
import ProjectList from "./ProjectList";
import AddProjectButton from "./AddProjectButton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button"; // Added
import { Settings as SettingsIcon } from "lucide-react"; // Added
import { useAppStore } from "@/stores/appStore"; // Added

export default function LeftSidebar() {
  const setActiveView = useAppStore((state) => state.setActiveView); // Added

  return (
    <Sidebar 
      variant="sidebar" 
      collapsible="icon" 
      className="fixed left-0 top-0 h-full z-20"
    >
      <SidebarHeader className="p-4">
        <h1 className="text-2xl font-semibold font-headline text-sidebar-foreground group-data-[collapsible=icon]:hidden">TabSpace</h1>
         <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-lg group-data-[collapsible=icon]:block hidden">
          TS
        </div>
      </SidebarHeader>
      <Separator className="bg-sidebar-border" />
      <SidebarContent className="flex-grow p-0">
        <ScrollArea className="h-full">
          <div className="p-4">
            <ProjectList />
          </div>
        </ScrollArea>
      </SidebarContent>
      <Separator className="bg-sidebar-border" />
      <SidebarFooter className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center mb-1" // Added mb-1
          onClick={() => setActiveView('settings')}
          aria-label="Open settings"
        >
          <SettingsIcon className="mr-2 h-5 w-5 group-data-[collapsible=icon]:mr-0" />
          <span className="group-data-[collapsible=icon]:hidden">Settings</span>
        </Button>
        <AddProjectButton />
      </SidebarFooter>
    </Sidebar>
  );
}

