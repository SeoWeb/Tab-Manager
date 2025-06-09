'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidUrl, cn } from '@/lib/utils';
import { Link } from '@/types';

export default function EditLinkModal() {
  const {
    isEditLinkModalOpen,
    closeEditLinkModal,
    updateLink,
    activeProjectId,
    editingCollectionId,
    editingLinkId,
    projects,
  } = useAppStore();

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

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLinkUrl(e.target.value);
    if (urlError) {
      setUrlError('');
    }
  };

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

  return (
    <ModalWrapper
      isOpen={isEditLinkModalOpen}
      onClose={closeEditLinkModal}
      title='Edit Link'
      description='Update the details of your saved link.'
    >
      <div className='space-y-4 py-4'>
        <div className='space-y-2'>
          <Label htmlFor='editLinkName'>Link Name (Optional)</Label>
          <Input
            id='editLinkName'
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder='e.g., Company Website'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='editLinkUrl'>Link URL</Label>
          <Input
            id='editLinkUrl'
            type='url'
            value={linkUrl}
            onChange={handleUrlChange}
            onBlur={() => {
              if (linkUrl.trim() && !isValidUrl(linkUrl)) {
                setUrlError(
                  'Please enter a valid URL (e.g., https://example.com)'
                );
              }
            }}
            placeholder='https://example.com'
            className={cn(
              urlError && 'border-red-500 focus-visible:ring-red-500'
            )}
          />
          {urlError && <p className='text-sm text-red-500 pt-1'>{urlError}</p>}
        </div>
      </div>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={closeEditLinkModal}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            !linkUrl.trim() ||
            !isValidUrl(linkUrl) ||
            (linkName === originalLink?.title && linkUrl === originalLink?.url)
          }
        >
          Save Changes
        </Button>
      </div>
    </ModalWrapper>
  );
}