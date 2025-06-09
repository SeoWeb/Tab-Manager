"use client";

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidUrl } from '@/lib/utils';

export default function AddLinkModal() {
  const { 
    isAddLinkModalOpen, 
    closeAddLinkModal, 
    addLink, 
    activeProjectId, 
    editingCollectionIdForLink 
  } = useAppStore();
  
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    // Reset form when modal opens/closes or collection context changes
    if (isAddLinkModalOpen) {
      setLinkName('');
      setLinkUrl('');
    }
  }, [isAddLinkModalOpen, editingCollectionIdForLink]);

  const handleSubmit = () => {
    if (linkUrl.trim() && activeProjectId && editingCollectionIdForLink && isValidUrl(linkUrl)) {
      addLink(activeProjectId, editingCollectionIdForLink, { 
        name: linkName.trim() || linkUrl, // Default name to URL if not provided
        url: linkUrl.trim() 
      });
      closeAddLinkModal();
    } else if (!isValidUrl(linkUrl)) {
      alert("Please enter a valid URL.");
    }
  };

  const currentCollection = useAppStore(state => 
    state.projects.find(p => p.id === state.activeProjectId)?.collections.find(c => c.id === state.editingCollectionIdForLink)
  );

  return (
    <ModalWrapper
      isOpen={isAddLinkModalOpen}
      onClose={closeAddLinkModal}
      title={`Add Link to "${currentCollection?.name || 'Collection'}"`}
      description="Save a new link to this collection."
    >
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="linkName">Link Name (Optional)</Label>
          <Input
            id="linkName"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder="e.g., Company Website"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="linkUrl">Link URL</Label>
          <Input
            id="linkUrl"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeAddLinkModal}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!linkUrl.trim() || !activeProjectId || !editingCollectionIdForLink || !isValidUrl(linkUrl)}>Add Link</Button>
      </div>
    </ModalWrapper>
  );
}
