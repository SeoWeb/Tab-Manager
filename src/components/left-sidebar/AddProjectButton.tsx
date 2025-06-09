"use client";

import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

export default function AddProjectButton() {
  const openAddProjectModal = useAppStore((state) => state.openAddProjectModal);

  return (
    <Button 
      variant="ghost" 
      className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
      onClick={openAddProjectModal}
      aria-label="Add new project"
    >
      <PlusCircle className="mr-2 h-5 w-5 group-data-[collapsible=icon]:mr-0" />
      <span className="group-data-[collapsible=icon]:hidden">New Project</span>
    </Button>
  );
}
