
"use client";

import { useAppStore } from "@/stores/appStore";
import ProjectHeader from "./ProjectHeader";
import CollectionsList from "./CollectionsList";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface MainContentAreaProps {
  className?: string;
}

export default function MainContentArea({ className }: MainContentAreaProps) {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeProject = useAppStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );

  if (!activeProjectId || !activeProject) {
    return (
      <div className={cn("flex-1 flex flex-col items-center justify-center p-8 bg-background text-foreground", className)}>
        <img src="https://placehold.co/300x200.png?text=TabSpace" alt="TabSpace Welcome" className="mb-8 rounded-lg shadow-md" data-ai-hint="welcome illustration"/>
        <h2 className="text-3xl font-headline mb-4">Welcome to TabSpace</h2>
        <p className="text-muted-foreground text-lg mb-2">Select a project to get started, or create a new one.</p>
        <p className="text-muted-foreground text-sm">Organize your digital life, one tab at a time.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex-1 flex flex-col bg-background overflow-hidden", className)}>
      <ProjectHeader project={activeProject} />
      <ScrollArea className="flex-1 p-4 md:p-6 lg:p-8">
        <CollectionsList project={activeProject} />
      </ScrollArea>
    </div>
  );
}
