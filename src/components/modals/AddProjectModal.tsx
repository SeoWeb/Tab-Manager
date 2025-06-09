import React, { useState } from 'react';
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
import { useAddProject } from '@/hooks/useAppStoreWithDefaults';
import { useToast } from '@/hooks/use-toast';
import ProjectForm from './ProjectForm';

interface AddProjectModalProps {
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AddProjectModal: React.FC<AddProjectModalProps> = ({
  children,
  isOpen,
  onOpenChange,
}) => {
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('#FFFFFF');
  const addProject = useAddProject();
  const { toast } = useToast();

  const handleSubmit = () => {
    if (projectName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    const projectInput = {
      name: projectName.trim(),
      color: projectColor,
    };

    addProject(projectInput);

    toast({
      title: 'Project Added',
      description: `'${projectInput.name}' has been successfully added.`,
    });

    setProjectName('');
    setProjectColor('#FFFFFF');
    if (onOpenChange) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Add New Project</DialogTitle>
          <DialogDescription>
            Enter the details for your new project. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>

        <ProjectForm
          projectName={projectName}
          projectColor={projectColor}
          onNameChange={setProjectName}
          onColorChange={setProjectColor}
          projectId='new-project'
        />

        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button type='submit' onClick={handleSubmit}>
            Save Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectModal;
