"use client";

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AddCollectionModal() {
  const { isAddCollectionModalOpen, closeAddCollectionModal, addCollection, activeProjectId } = useAppStore();
  const [collectionName, setCollectionName] = useState('');

  const handleSubmit = () => {
    if (collectionName.trim() && activeProjectId) {
      addCollection(activeProjectId, { name: collectionName.trim() });
      setCollectionName('');
      closeAddCollectionModal();
    }
  };

  return (
    <ModalWrapper
      isOpen={isAddCollectionModalOpen}
      onClose={closeAddCollectionModal}
      title="Create New Collection"
      description="Organize your links into collections."
    >
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="collectionName">Collection Name</Label>
          <Input
            id="collectionName"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder="e.g., Social Media Assets"
          />
        </div>
      </div>
       <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeAddCollectionModal}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!collectionName.trim() || !activeProjectId}>Create Collection</Button>
      </div>
    </ModalWrapper>
  );
}
