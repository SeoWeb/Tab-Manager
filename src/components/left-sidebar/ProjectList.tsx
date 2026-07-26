'use client';

import {
  useProjects,
  useActiveProjectId,
  useSetActiveProject,
  useHasHydrated,
} from '@/hooks/useAppStoreWithDefaults';
import ProjectItem from './ProjectItem';
import { SortableProjectItem } from '../drag-drop/SortableProjectItem';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useCallback, useEffect, useMemo } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useAppStore } from '@/stores/appStore';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectList() {
  const projects = useProjects();
  const activeProjectId = useActiveProjectId();
  const setActiveProject = useSetActiveProject();
  const { open: sidebarOpen } = useSidebarState();
  const { migrateProjectOrder } = useAppStore();
  const _hasHydrated = useHasHydrated();

  // Migrate project order on mount if needed
  useEffect(() => {
    migrateProjectOrder();
  }, [migrateProjectOrder]);

  // Sort projects by order
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [projects]
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

  if (!_hasHydrated) {
    return (
      <div className='h-full overflow-y-auto scrollbar-modern px-2 py-2'>
        <SidebarMenu>
          {Array.from({ length: 6 }).map((_, i) => (
            <SidebarMenuItem key={i}>
              <div className='flex items-center gap-2 px-2 py-2'>
                <Skeleton className='h-8 w-8 rounded-md' />
                <div className='flex-1 space-y-1.5'>
                  <Skeleton className='h-3 w-3/4' />
                  <Skeleton className='h-2 w-1/2' />
                </div>
              </div>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </div>
    );
  }

  if (sortedProjects.length === 0) {
    return (
      <p className='text-sm text-sidebar-foreground/70 text-center group-data-[collapsible=icon]:hidden p-4'>
        No projects yet. Add one!
      </p>
    );
  }

  return (
    <div className='h-full overflow-y-auto scrollbar-modern px-2 py-2'>
      <SidebarMenu>
        <SortableContext
          items={sortedProjects.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className='space-y-1'>
            {sortedProjects.map((project) => (
              <SidebarMenuItem key={project.id}>
                {sidebarOpen ? (
                  <SortableProjectItem project={project} />
                ) : (
                  <ProjectItem project={project} />
                )}
              </SidebarMenuItem>
            ))}
          </div>
        </SortableContext>
      </SidebarMenu>
    </div>
  );
}
