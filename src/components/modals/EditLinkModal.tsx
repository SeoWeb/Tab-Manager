'use client';

import { useState, useEffect } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { isValidUrl } from '@/lib/utils';
import { Link } from '@/types';
import LinkForm from './LinkForm';
import { Trash2 } from 'lucide-react';

export default function EditLinkModal() {
  const isEditLinkModalOpen = useAppStoreWithDefaults(
    (state) => state.isEditLinkModalOpen,
    false
  );
  const closeEditLinkModal = useAppStoreWithDefaults(
    (state) => state.closeEditLinkModal,
    () => {}
  );
  const updateLink = useAppStoreWithDefaults(
    (state) => state.updateLink,
    () => {}
  );
  const deleteLink = useAppStoreWithDefaults(
    (state) => state.deleteLink,
    () => {}
  );
  const activeProjectId = useAppStoreWithDefaults(
    (state) => state.activeProjectId,
    null
  );
  const editingCollectionId = useAppStoreWithDefaults(
    (state) => state.editingCollectionId,
    null
  );
  const editingLinkId = useAppStoreWithDefaults(
    (state) => state.editingLinkId,
    null
  );
  const projects = useAppStoreWithDefaults((state) => state.projects, []);

  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [originalLink, setOriginalLink] = useState<Link | null>(null);

  useEffect(() => {
    if (
      isEditLinkModalOpen &&
      activeProjectId &&
      editingCollectionId &&
      editingLinkId
    ) {
      const project = projects.find((p) => p.id === activeProjectId);
      const collection = project?.collections.find(
        (c) => c.id === editingCollectionId
      );
      const link = collection?.links.find((l) => l.id === editingLinkId);

      if (link) {
        setLinkName(link.title || '');
        setLinkUrl(link.url);
        setOriginalLink(link);
      }
      setUrlError('');
    } else {
      setLinkName('');
      setLinkUrl('');
      setUrlError('');
      setOriginalLink(null);
    }
  }, [
    isEditLinkModalOpen,
    activeProjectId,
    editingCollectionId,
    editingLinkId,
    projects,
  ]);

  const handleSubmit = () => {
    if (!linkUrl.trim() || !isValidUrl(linkUrl)) {
      setUrlError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    if (
      activeProjectId &&
      editingCollectionId &&
      editingLinkId &&
      originalLink
    ) {
      updateLink(activeProjectId, editingCollectionId, editingLinkId, {
        ...originalLink,
        title: linkName.trim() || linkUrl.trim(),
        url: linkUrl.trim(),
      });
      closeEditLinkModal();
    }
  };

  const handleDelete = () => {
    if (
      activeProjectId &&
      editingCollectionId &&
      editingLinkId &&
      confirm('Are you sure you want to delete this link?')
    ) {
      deleteLink(activeProjectId, editingCollectionId, editingLinkId);
      closeEditLinkModal();
    }
  };

  return (
    <ModalWrapper
      isOpen={isEditLinkModalOpen}
      onClose={closeEditLinkModal}
      title='Edit Link'
      description='Update the details of your saved link.'
    >
      <LinkForm
        linkName={linkName}
        linkUrl={linkUrl}
        urlError={urlError}
        onNameChange={setLinkName}
        onUrlChange={setLinkUrl}
        onUrlError={setUrlError}
        nameFieldId='editLinkName'
        urlFieldId='editLinkUrl'
      />

      <div className='flex justify-between'>
        <Button
          variant='destructive'
          onClick={handleDelete}
          className='flex items-center gap-2'
        >
          <Trash2 className='h-4 w-4' />
          Delete Link
        </Button>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={closeEditLinkModal}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !linkUrl.trim() ||
              !isValidUrl(linkUrl) ||
              (linkName === originalLink?.title &&
                linkUrl === originalLink?.url)
            }
          >
            Save Changes
          </Button>
        </div>
      </div>
    </ModalWrapper>
  );
}
