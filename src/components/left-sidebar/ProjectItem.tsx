'use client';

import type { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { getInitials } from '@/lib/utils';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface ProjectItemProps {
  project: Project;
}

export default function ProjectItem({ project }: ProjectItemProps) {
  const { activeProjectId, setActiveProject } = useAppStore((state) => ({
    activeProjectId: state.activeProjectId,
    setActiveProject: state.setActiveProject,
  }));

  const isActive = project.id === activeProjectId;

  return (
    <SidebarMenuButton
      onClick={() => setActiveProject(project.id)}
      isActive={isActive}
      className={cn(
        'w-full justify-start',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90'
          : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}
      tooltip={project.name}
    >
      <div
        className='w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0'
        style={{ backgroundColor: project.color, color: '#FFFFFF' }} // Assuming white text on colored background
      >
        {getInitials(project.name)}
      </div>
      <span className='truncate group-data-[collapsible=icon]:hidden'>
        {project.name}
      </span>
    </SidebarMenuButton>
  );
}
