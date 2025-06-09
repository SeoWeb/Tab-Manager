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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'; // Added AlertDialog imports
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
import { Project } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Trash2Icon } from 'lucide-react'; // For delete button icon

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
  // AlertDialog open state is managed by its own trigger/content props typically,
  // but if needed for more complex scenarios, state can be used:
  // const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { updateProject, deleteProject } = useAppStore((state) => ({
    updateProject: state.updateProject,
    deleteProject: state.deleteProject,
  }));
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
      variant: 'destructive', // Good to use destructive variant for delete actions
    });
    if (onOpenChange) onOpenChange(false); // Close the main edit modal
    // setShowDeleteConfirm(false); // If using state for AlertDialog
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
        <div className='grid gap-4 py-4'>
          {/* Project Name Input */}
          <div className='grid grid-cols-4 items-center gap-4'>
            <Label
              htmlFor={`edit-projectName-${project.id}`}
              className='text-right'
            >
              Name
            </Label>
            <Input
              id={`edit-projectName-${project.id}`}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className='col-span-3'
              placeholder='Project name'
            />
          </div>
          {/* Project Color Input */}
          <div className='grid grid-cols-4 items-center gap-4'>
            <Label
              htmlFor={`edit-projectColor-${project.id}`}
              className='text-right'
            >
              Color
            </Label>
            <Input
              id={`edit-projectColor-${project.id}`}
              type='color'
              value={projectColor}
              onChange={(e) => setProjectColor(e.target.value)}
              className='col-span-3 h-8'
            />
          </div>
        </div>
        <DialogFooter className='sm:justify-between'>
          {' '}
          {/* Adjusted footer for spacing */}
          <div>
            {' '}
            {/* Container for Delete Button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant='destructive' size='sm'>
                  <Trash2Icon className='mr-2 h-4 w-4' /> Delete Project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    the project &quot;{project.name}&quot; and all its
                    associated collections and links.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteConfirmed}>
                    Yes, delete project
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className='flex gap-2'>
            {' '}
            {/* Container for Cancel and Save Changes */}
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
