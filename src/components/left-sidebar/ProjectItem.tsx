// src/components/left-sidebar/ProjectItem.tsx
import React, { useState } from 'react';
import { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import EditProjectModal from '@/components/modals/EditProjectModal'; // Import the new modal
import { PencilIcon } from 'lucide-react'; // Example icon
import { Button } from '@/components/ui/button'; // Import Button

interface ProjectItemProps {
  project: Project;
}

const ProjectItem: React.FC<ProjectItemProps> = ({ project }) => {
  const { activeProjectId, setActiveProjectId } = useAppStore((state) => ({
    activeProjectId: state.activeProjectId,
    setActiveProjectId: state.setActiveProjectId,
  }));
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const initials = project.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const isActive = project.id === activeProjectId;

  return (
    <div className="relative group"> {/* Added for positioning edit button */}
      <EditProjectModal project={project} isOpen={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        {/* Hidden trigger, modal controlled by state. Actual trigger is the button below */}
        <button style={{ display: 'none' }} />
      </EditProjectModal>

      <button
        onClick={() => setActiveProjectId(project.id)}
        className={cn(
          'flex items-center w-full p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500',
          isActive ? 'bg-blue-100 dark:bg-blue-800' : ''
        )}
        title={project.name}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold mr-3 flex-shrink-0"
          style={{ backgroundColor: project.color || '#CCCCCC' }} // Use project color
        >
          {initials}
        </div>
        <span className="truncate flex-grow text-left">{project.name}</span>
      </button>

      {/* Edit button - appears on hover or focus */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={(e) => {
          e.stopPropagation(); // Prevent project selection when clicking edit
          setIsEditModalOpen(true);
        }}
        title={`Edit ${project.name}`}
      >
        <PencilIcon className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default ProjectItem;
