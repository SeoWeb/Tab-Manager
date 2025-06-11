'use client';

import {
  useProjects,
  useActiveProjectId,
  useSetActiveProject,
} from '@/hooks/useAppStoreWithDefaults';
import ProjectItem from './ProjectItem';
import { SortableProjectItem } from '../drag-drop/SortableProjectItem';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useCallback, useEffect } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useAppStore } from '@/stores/appStore';

export default function ProjectList() {
  const projects = useProjects();
  const activeProjectId = useActiveProjectId();
  const setActiveProject = useSetActiveProject();
  const { open: sidebarOpen } = useSidebarState();
  const { migrateProjectOrder } = useAppStore();

  // Migrate project order on mount if needed
  useEffect(() => {
    migrateProjectOrder();
  }, [migrateProjectOrder]);

  // Sort projects by order
  const sortedProjects = [...projects].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  const handleNavigation = useCallback(
    (direction: 'up' | 'down') => {
      if (!activeProjectId) return;
      const currentIndex = sortedProjects.findIndex(
        (p) => p.id === activeProjectId
      );
      if (currentIndex === -1) return;

      const nextIndex =
        direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (nextIndex >= 0 && nextIndex < sortedProjects.length) {
        setActiveProject(sortedProjects[nextIndex].id);
      }
    },
    [activeProjectId, sortedProjects, setActiveProject]
  );

  useHotkeys('up', () => handleNavigation('up'));
  useHotkeys('down', () => handleNavigation('down'));

  if (sortedProjects.length === 0) {
    return (
      <p className='text-sm text-sidebar-foreground/70 text-center group-data-[collapsible=icon]:hidden p-4'>
        No projects yet. Add one!
      </p>
    );
  }

  return (
    <SidebarMenu>
      <SortableContext
        items={sortedProjects.map((p) => p.id)}
        strategy={verticalListSortingStrategy}
      >
        {sortedProjects.map((project) => (
          <SidebarMenuItem key={project.id}>
            {sidebarOpen ? (
              <SortableProjectItem project={project} />
            ) : (
              <ProjectItem project={project} />
            )}
          </SidebarMenuItem>
        ))}
      </SortableContext>
    </SidebarMenu>
  );
}
