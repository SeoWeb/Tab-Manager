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
import { Collection } from '@/types';
import { Trash2Icon } from 'lucide-react';

interface DeleteCollectionConfirmationProps {
  collection: Collection;
  onDeleteConfirmed: () => void;
}

const DeleteCollectionConfirmation: React.FC<
  DeleteCollectionConfirmationProps
> = ({ collection, onDeleteConfirmed }) => {
  return (
    <div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant='destructive' size='sm'>
            <Trash2Icon className='mr-2 h-4 w-4' /> Delete Collection
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              collection &quot;{collection.name}&quot; and all its links.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteConfirmed}>
              Yes, delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DeleteCollectionConfirmation;
