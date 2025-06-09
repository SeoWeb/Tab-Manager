import React, { useState } from 'react';
import { Project } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsIcon } from 'lucide-react';
import EditProjectModal from '@/components/modals/EditProjectModal';

interface ProjectActionsMenuProps {
  project: Project;
}

const ProjectActionsMenu: React.FC<ProjectActionsMenuProps> = ({ project }) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleEditProjectTrigger = () => {
    setIsEditModalOpen(true);
  };

  const handleDeleteProjectTrigger = () => {
    // This will also open the EditProjectModal, where the user can then click the delete button.
    setIsEditModalOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label='Project settings'>
            <SettingsIcon className='h-5 w-5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Project Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleEditProjectTrigger}>
            Edit Project
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDeleteProjectTrigger}
            className='text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-700/20 dark:focus:text-red-500'
          >
            Delete Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Project Modal Instance */}
      <EditProjectModal
        project={project}
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      >
        <div />
      </EditProjectModal>
    </>
  );
};

export default ProjectActionsMenu;
