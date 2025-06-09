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
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { Collection } from '@/types';
import { useToast } from '@/hooks/use-toast';
import CollectionForm from './CollectionForm';
import DeleteCollectionConfirmation from './DeleteCollectionConfirmation';

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
      description: `'${collectionName.trim()}' has been successfully updated.`,
    });
    if (onOpenChange) onOpenChange(false);
  };

  const handleDeleteConfirmed = () => {
    deleteCollection(projectId, collection.id);
    toast({
      title: 'Collection Deleted',
      description: `'${collection.name}' has been successfully deleted.`,
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

        <CollectionForm
          collectionName={collectionName}
          collectionDescription={collectionDescription}
          onNameChange={setCollectionName}
          onDescriptionChange={setCollectionDescription}
          collectionId={collection.id}
        />

        <DialogFooter className='sm:justify-between'>
          <DeleteCollectionConfirmation
            collection={collection}
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

export default EditCollectionModal;
