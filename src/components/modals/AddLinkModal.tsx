'use client';

import { useState, useEffect } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { isValidUrl } from '@/lib/utils';
import LinkForm from './LinkForm';

export default function AddLinkModal() {
  const isAddLinkModalOpen = useAppStoreWithDefaults(
    (state) => state.isAddLinkModalOpen,
    false
  );
  const closeAddLinkModal = useAppStoreWithDefaults(
    (state) => state.closeAddLinkModal,
    () => {}
  );
  const addLink = useAppStoreWithDefaults(
    (state) => state.addLink,
    () => {}
  );
  const activeProjectId = useAppStoreWithDefaults(
    (state) => state.activeProjectId,
    null
  );
  const editingCollectionIdForLink = useAppStoreWithDefaults(
    (state) => state.editingCollectionIdForLink,
    null
  );

  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    // Reset form when modal opens/closes or collection context changes
    if (isAddLinkModalOpen) {
      setLinkName('');
      setLinkUrl('');
      setUrlError('');
    }
  }, [isAddLinkModalOpen, editingCollectionIdForLink]);

  const handleSubmit = () => {
    if (!linkUrl.trim() || !isValidUrl(linkUrl)) {
      setUrlError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    if (activeProjectId && editingCollectionIdForLink) {
      addLink(activeProjectId, editingCollectionIdForLink, {
        title: linkName.trim() || linkUrl.trim(),
        url: linkUrl.trim(),
      });
      closeAddLinkModal();
    }
  };

  const currentCollection = useAppStoreWithDefaults((state) => {
    if (
      !state.projects ||
      !state.activeProjectId ||
      !state.editingCollectionIdForLink
    ) {
      return null;
    }
    return (
      state.projects
        .find((p) => p.id === state.activeProjectId)
        ?.collections.find((c) => c.id === state.editingCollectionIdForLink) ||
      null
    );
  }, null);

  return (
    <ModalWrapper
      isOpen={isAddLinkModalOpen}
      onClose={closeAddLinkModal}
      title={`Add Link to "${currentCollection?.name || 'Collection'}"`}
      description='Save a new link to this collection.'
    >
      <LinkForm
        linkName={linkName}
        linkUrl={linkUrl}
        urlError={urlError}
        onNameChange={setLinkName}
        onUrlChange={setLinkUrl}
        onUrlError={setUrlError}
        nameFieldId='linkName'
        urlFieldId='linkUrl'
      />

      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={closeAddLinkModal}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            !linkUrl.trim() ||
            !activeProjectId ||
            !editingCollectionIdForLink ||
            !isValidUrl(linkUrl)
          }
        >
          Add Link
        </Button>
      </div>
    </ModalWrapper>
  );
}
