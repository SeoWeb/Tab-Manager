import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Project } from '@/types';
import { useToast } from '@/hooks/use-toast';
import ProjectForm from './ProjectForm';
import DeleteProjectConfirmation from './DeleteProjectConfirmation';

interface EditProjectModalProps {
  project: Project;
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EditProjectModal: React.FC<EditProjectModalProps> = ({
  project,
  children,
  isOpen,
  onOpenChange,
}) => {
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('');

  const { updateProject, deleteProject } = useAppStore(
    useShallow((state) => ({
      updateProject: state.updateProject,
      deleteProject: state.deleteProject,
    }))
  );
  const { toast } = useToast();

  useEffect(() => {
    if (project) {
      setProjectName(project.name);
      setProjectColor(project.color || '#FFFFFF');
    }
  }, [project, isOpen]);

  const handleSubmit = () => {
    if (projectName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    updateProject(project.id, {
      name: projectName.trim(),
      color: projectColor,
    });
    toast({
      title: 'Project Updated',
      description: `'${projectName.trim()}' has been successfully updated.`,
    });
    if (onOpenChange) onOpenChange(false);
  };

  const handleDeleteConfirmed = () => {
    deleteProject(project.id);
    toast({
      title: 'Project Deleted',
      description: `'${project.name}' has been successfully deleted.`,
      variant: 'destructive',
    });
    if (onOpenChange) onOpenChange(false);
  };

  if (!project) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update the details for your project. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>

        <ProjectForm
          projectName={projectName}
          projectColor={projectColor}
          onNameChange={setProjectName}
          onColorChange={setProjectColor}
          projectId={project.id}
        />

        <DialogFooter className='sm:justify-between'>
          <DeleteProjectConfirmation
            project={project}
            onDeleteConfirmed={handleDeleteConfirmed}
          />
          <div className='flex gap-2'>
            <DialogClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogClose>
            <Button type='submit' onClick={handleSubmit}>
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectModal;
