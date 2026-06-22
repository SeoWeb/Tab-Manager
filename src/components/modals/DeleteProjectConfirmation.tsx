import React from 'react';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Project } from '@/types';
import { Trash2Icon } from 'lucide-react';
import { canDeleteProject } from '@/lib/cloudflareSync/roles';

interface DeleteProjectConfirmationProps {
  project: Project;
  onDeleteConfirmed: () => void;
}

const DeleteProjectConfirmation: React.FC<DeleteProjectConfirmationProps> = ({
  project,
  onDeleteConfirmed,
}) => {
  const deleteDisabled = !canDeleteProject(
    project.cloudRole,
    project.cloudEnabled
  );

  return (
    <div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant='destructive' size='sm' disabled={deleteDisabled}>
            <Trash2Icon className='mr-2 h-4 w-4' /> Delete Project
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              project &quot;{project.name}&quot; and all its associated
              collections and links.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteConfirmed}>
              Yes, delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DeleteProjectConfirmation;
