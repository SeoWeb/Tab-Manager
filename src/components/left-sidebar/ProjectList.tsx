'use client';

import {
  useProjects,
  useActiveProjectId,
  useSetActiveProject,
} from '@/hooks/useAppStoreWithDefaults';
import ProjectItem from './ProjectItem';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useCallback } from 'react';

export default function ProjectList() {
  const projects = useProjects();
  const activeProjectId = useActiveProjectId();
  const setActiveProject = useSetActiveProject();

  const handleNavigation = useCallback(
    (direction: 'up' | 'down') => {
      if (!activeProjectId) return;
      const currentIndex = projects.findIndex((p) => p.id === activeProjectId);
      if (currentIndex === -1) return;

      const nextIndex =
        direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (nextIndex >= 0 && nextIndex < projects.length) {
        setActiveProject(projects[nextIndex].id);
      }
    },
    [activeProjectId, projects, setActiveProject]
  );

  useHotkeys('up', () => handleNavigation('up'));
  useHotkeys('down', () => handleNavigation('down'));

  if (projects.length === 0) {
    return (
      <p className='text-sm text-sidebar-foreground/70 text-center group-data-[collapsible=icon]:hidden p-4'>
        No projects yet. Add one!
      </p>
    );
  }

  return (
    <SidebarMenu>
      {projects.map((project) => (
        <SidebarMenuItem key={project.id}>
          <ProjectItem project={project} />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
