'use client';

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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/appStore';
import { Collection } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Trash2Icon } from 'lucide-react';

interface EditCollectionModalProps {
  collection: Collection;
  projectId: string;
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EditCollectionModal: React.FC<EditCollectionModalProps> = ({
  collection,
  projectId,
  children,
  isOpen,
  onOpenChange,
}) => {
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');

  const { updateCollection, deleteCollection } = useAppStore((state) => ({
    updateCollection: state.updateCollection,
    deleteCollection: state.deleteCollection,
  }));
  const { toast } = useToast();

  useEffect(() => {
    if (collection) {
      setCollectionName(collection.name);
      setCollectionDescription(collection.description || '');
    }
  }, [collection, isOpen]);

  const handleSubmit = () => {
    if (collectionName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Collection name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    updateCollection(projectId, collection.id, {
      name: collectionName.trim(),
      description: collectionDescription.trim(),
    });
    toast({
      title: 'Collection Updated',
      description: `&apos;${collectionName.trim()}&apos; has been successfully updated.`,
    });
    if (onOpenChange) onOpenChange(false);
  };

  const handleDeleteConfirmed = () => {
    deleteCollection(projectId, collection.id);
    toast({
      title: 'Collection Deleted',
      description: `&apos;${collection.name}&apos; has been successfully deleted.`,
      variant: 'destructive',
    });
    if (onOpenChange) onOpenChange(false);
  };

  if (!collection) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Edit Collection</DialogTitle>
          <DialogDescription>
            Update the details for your collection. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-4 items-center gap-4'>
            <Label
              htmlFor={`edit-collectionName-${collection.id}`}
              className='text-right'
            >
              Name
            </Label>
            <Input
              id={`edit-collectionName-${collection.id}`}
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              className='col-span-3'
              placeholder='Collection name'
            />
          </div>
          <div className='grid grid-cols-4 items-center gap-4'>
            <Label
              htmlFor={`edit-collectionDescription-${collection.id}`}
              className='text-right'
            >
              Description
            </Label>
            <Textarea
              id={`edit-collectionDescription-${collection.id}`}
              value={collectionDescription}
              onChange={(e) => setCollectionDescription(e.target.value)}
              className='col-span-3'
              placeholder='A brief description of this collection.'
            />
          </div>
        </div>
        <DialogFooter className='sm:justify-between'>
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
                    This action cannot be undone. This will permanently delete
                    the collection &quot;{collection.name}&quot; and all its
                    links.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteConfirmed}>
                    Yes, delete collection
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
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

export default EditCollectionModal;
