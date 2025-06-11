// src/components/left-sidebar/ProjectItem.tsx
import React, { useState } from 'react';
import { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import EditProjectModal from '@/components/modals/EditProjectModal'; // Import the new modal
import { PencilIcon, GripVertical } from 'lucide-react'; // Example icon
import { Button } from '@/components/ui/button'; // Import Button
import { useSidebarState } from '@/hooks/useSidebarState';

interface ProjectItemProps {
  project: Project;
  showDragHandle?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  showDragHandle = false,
  dragHandleProps,
}) => {
  const { activeProjectId, setActiveProject } = useAppStore((state) => ({
    activeProjectId: state.activeProjectId,
    setActiveProject: state.setActiveProject,
  }));
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { open: sidebarOpen } = useSidebarState();

  const initials = project.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const isActive = project.id === activeProjectId;

  return (
    <div className='relative group'>
      {' '}
      {/* Added for positioning edit button */}
      <EditProjectModal
        project={project}
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      >
        {/* Hidden trigger, modal controlled by state. Actual trigger is the button below */}
        <button style={{ display: 'none' }} />
      </EditProjectModal>
      <div className={cn('flex items-center', sidebarOpen ? 'w-full' : '')}>
        {/* Drag Handle - only show when sidebar is open and showDragHandle is true */}
        {sidebarOpen && showDragHandle && (
          <div
            {...dragHandleProps}
            className='flex items-center justify-center w-6 h-6 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 mr-1'
            title='Drag to reorder'
          >
            <GripVertical className='h-4 w-4' />
          </div>
        )}

        <button
          onClick={() => setActiveProject(project.id)}
          className={cn(
            'flex items-center hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500',
            isActive ? 'bg-primary/25' : '',
            sidebarOpen ? 'p-2 rounded-md gap-3 flex-1' : 'rounded-full',
            isActive && !sidebarOpen ? 'border-2 border-primary' : ''
          )}
          title={project.name}
        >
          <div
            className='w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0'
            style={{ backgroundColor: project.color || '#CCCCCC' }} // Use project color
          >
            {initials}
          </div>
          {sidebarOpen && (
            <span className='truncate flex-grow text-left'>{project.name}</span>
          )}
        </button>
      </div>
      {/* Edit button - appears on hover or focus */}
      {sidebarOpen && (
        <Button
          variant='ghost'
          size='sm'
          className='absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100'
          onClick={(e) => {
            e.stopPropagation(); // Prevent project selection when clicking edit
            setIsEditModalOpen(true);
          }}
          title={`Edit ${project.name}`}
        >
          <PencilIcon className='h-4 w-4' />
        </Button>
      )}
    </div>
  );
};

export default ProjectItem;
