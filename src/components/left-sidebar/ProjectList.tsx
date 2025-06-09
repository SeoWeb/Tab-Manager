'use client';

import { useAppStore } from '@/stores/appStore';
import ProjectItem from './ProjectItem';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';

export default function ProjectList() {
  const projects = useAppStore((state) => state.projects);

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
