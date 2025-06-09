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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
// Project type is not strictly needed here for a new project,
// as appStore's addProject defines the creation signature.
// However, if we were to use the full Project type for `newProject`
// we would import it: import { Project } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface AddProjectModalProps {
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AddProjectModal: React.FC<AddProjectModalProps> = ({ children, isOpen, onOpenChange }) => {
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('#FFFFFF'); // Default color
  const addProject = useAppStore((state) => state.addProject);
  const { toast } = useToast(); // For displaying notifications

  const handleSubmit = () => {
    if (projectName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    // The appStore's addProject action expects an object with only the properties
    // that are not auto-generated (id, collections, createdAt, updatedAt).
    // Default values for description and icon are also handled by the store.
    const projectInput = {
      name: projectName.trim(),
      color: projectColor,
      // No need to specify id, collections, createdAt, updatedAt here
      // Optional: description: '', icon: ''
    };

    // The store will create the full Project object.
    // We pass only the necessary fields.
    addProject(projectInput);

    toast({
      title: 'Project Added',
      description: `'${projectInput.name}' has been successfully added.`,
    });

    setProjectName('');
    setProjectColor('#FFFFFF');
    if (onOpenChange) {
      onOpenChange(false); // Close modal on submit
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Project</DialogTitle>
          <DialogDescription>
            Enter the details for your new project. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="projectName" className="text-right">
              Name
            </Label>
            <Input
              id="projectName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="col-span-3"
              placeholder="Project name"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="projectColor" className="text-right">
              Color
            </Label>
            <Input
              id="projectColor"
              type="color"
              value={projectColor}
              onChange={(e) => setProjectColor(e.target.value)}
              className="col-span-3 h-8"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" onClick={handleSubmit}>Save Project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectModal;
