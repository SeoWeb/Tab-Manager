"use client";

import type { Project } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, Search, Moon, Sun, PanelRightOpen, PanelRightClose, PanelLeft } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { SidebarTrigger } from "@/components/ui/sidebar"; // Import SidebarTrigger

interface ProjectHeaderProps {
  project: Project;
}

export default function ProjectHeader({ project }: ProjectHeaderProps) {
  const { toggleRightPanel, isRightPanelOpen, toggleDarkMode, isDarkMode } = useAppStore();

  return (
    <header className="p-4 border-b border-border bg-card flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="md:hidden" /> {/* Hidden on md and larger screens */}
        <h2 className="text-xl font-semibold font-headline text-card-foreground">{project.name}</h2>
      </div>
      <div className="flex items-center gap-2">
        {/* Search Input - Placeholder for now */}
        {/* <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search links..." className="pl-8" />
        </div> */}
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}>
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        {/* <Button variant="ghost" size="icon" aria-label="Project settings">
          <Settings className="h-5 w-5" />
        </Button> */}
        <Button variant="ghost" size="icon" onClick={toggleRightPanel} aria-label={isRightPanelOpen ? "Close right panel" : "Open right panel"}>
          {isRightPanelOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  );
}
