'use client';

import { useState } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import CollectionForm from './CollectionForm';

export default function AddCollectionModal() {
  const isAddCollectionModalOpen = useAppStoreWithDefaults(
    (state) => state.isAddCollectionModalOpen,
    false
  );
  const closeAddCollectionModal = useAppStoreWithDefaults(
    (state) => state.closeAddCollectionModal,
    () => {}
  );
  const addCollection = useAppStoreWithDefaults(
    (state) => state.addCollection,
    () => {}
  );
  const activeProjectId = useAppStoreWithDefaults(
    (state) => state.activeProjectId,
    null
  );
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');

  const handleSubmit = () => {
    if (collectionName.trim() && activeProjectId) {
      addCollection(activeProjectId, {
        name: collectionName.trim(),
        description: collectionDescription.trim() || undefined,
      });
      setCollectionName('');
      setCollectionDescription('');
      closeAddCollectionModal();
    }
  };

  return (
    <ModalWrapper
      isOpen={isAddCollectionModalOpen}
      onClose={closeAddCollectionModal}
      title='Create New Collection'
      description='Organize your links into collections.'
    >
      <CollectionForm
        collectionName={collectionName}
        collectionDescription={collectionDescription}
        onNameChange={setCollectionName}
        onDescriptionChange={setCollectionDescription}
        collectionId='new-collection'
      />

      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={closeAddCollectionModal}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!collectionName.trim() || !activeProjectId}
        >
          Create Collection
        </Button>
      </div>
    </ModalWrapper>
  );
}
