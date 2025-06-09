"use client";

import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter } from "@/components/ui/sidebar";
import ProjectList from "./ProjectList";
import AddProjectButton from "./AddProjectButton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function LeftSidebar() {
  return (
    <Sidebar variant="sidebar" collapsible="icon">
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
        <AddProjectButton />
      </SidebarFooter>
    </Sidebar>
  );
}
