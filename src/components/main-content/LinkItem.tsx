'use client';

import type { Link } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ExternalLink, Edit3, GripVertical } from 'lucide-react';
import Image from 'next/image';
import { useFavicon } from '@/hooks/useFavicon';
import { Skeleton } from '@/components/ui/skeleton';
import { highlightText } from '@/lib/highlight';
import { useDndContext } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { convertChromeFaviconUrl } from '@/lib/faviconService';

interface LinkItemProps {
  link: Link;
  projectId: string;
  collectionId: string;
  showDragHandle?: boolean;
  dragHandleProps?: DraggableAttributes & {
    listeners?: SyntheticListenerMap;
  };
}

export default function LinkItem({
  link,
  projectId,
  collectionId,
  showDragHandle = false,
  dragHandleProps,
}: LinkItemProps) {
  const { active } = useDndContext();
  const { openEditLinkModal, searchQuery } = useAppStore((state) => ({
    deleteLink: state.deleteLink,
    openEditLinkModal: state.openEditLinkModal,
    searchQuery: state.searchQuery,
  }));
  // Known viewer role on a shared cloud project → disable edits. Local-only
  // projects (no role) are fully editable; the backend still guards writes.
  const readOnly = useAppStore((state) => {
    const project = state.projects.find((p) => p.id === projectId);
    return !!project?.cloudRole && project.cloudRole === 'viewer';
  });
  const { favicon, loading } = useFavicon(link.url);

  // Check if we're dragging an external item (tab/bookmark)
  const isDraggingExternalItem =
    active?.data?.current?.type === 'tab' ||
    active?.data?.current?.type === 'bookmark';

  return (
    <div
      className={`group flex items-center p-1 gap-2 bg-background rounded-lg border border-input transition-colors duration-150 shadow-sm w-64 ${
        isDraggingExternalItem ? 'opacity-75' : 'hover:bg-secondary/50'
      }`}
    >
      {/* Drag handle */}
      {showDragHandle && (
        <div
          {...dragHandleProps}
          className='cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition-opacity p-1 hover:bg-secondary/50 rounded hidden group-hover:flex'
          title='Drag to reorder'
        >
          <GripVertical className='h-4 w-4 text-muted-foreground' />
        </div>
      )}
      {loading ? (
        <Skeleton className='h-8 w-8 rounded' />
      ) : (
        <a
          href={link.url}
          target='_blank'
          rel='noopener noreferrer'
          onClick={
            isDraggingExternalItem ? (e) => e.preventDefault() : undefined
          }
          className={isDraggingExternalItem ? 'pointer-events-none' : ''}
        >
          <Image
            src={convertChromeFaviconUrl(
              link.favIconUrl || favicon || 'https://placehold.co/32x32.png'
            )}
            alt='favicon'
            width={32}
            height={32}
            className='rounded shrink-0 hover:opacity-80 transition-opacity cursor-pointer'
            unoptimized
            onError={(e) => {
              console.error('Favicon load error:', {
                url: link.url,
                favIconUrl: link.favIconUrl,
                fallbackFavicon: favicon,
                error: e,
              });
              // Try fallback favicon first, then placeholder
              if (
                e.currentTarget.src !==
                convertChromeFaviconUrl(link.favIconUrl || favicon)
              ) {
                e.currentTarget.src = 'https://placehold.co/32x32.png';
              }
            }}
            onLoad={() => {
              console.log('Favicon loaded successfully:', {
                url: link.url,
                favIconUrl: link.favIconUrl,
                fallbackFavicon: favicon,
              });
            }}
          />
        </a>
      )}
      <div className='flex-1 min-w-0'>
        <a
          href={link.url}
          rel='noopener noreferrer'
          className={`text-sm font-medium text-foreground truncate block pt-2 pb-2 ${
            isDraggingExternalItem ? 'pointer-events-none' : 'hover:underline'
          }`}
          title={link.url}
          onClick={
            isDraggingExternalItem ? (e) => e.preventDefault() : undefined
          }
        >
          {highlightText(link.title || link.url, searchQuery)}
        </a>
        {/* {link.title && (
        <p className='hidden group-hover:flex text-xs text-muted-foreground truncate'>
        {highlightText(link.url, searchQuery)}
        </p>
      )} */}
      </div>
      <div
        className={`hidden group-hover:flex items-center gap-1 shrink-0 ${
          isDraggingExternalItem ? 'pointer-events-none' : ''
        }`}
      >
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6'
          asChild
          aria-label='Open link in new tab'
          disabled={isDraggingExternalItem}
        >
          <a href={link.url} target='_blank' rel='noopener noreferrer'>
            <ExternalLink className='h-3 w-3 text-muted-foreground hover:text-primary' />
          </a>
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6'
          aria-label='Edit link'
          onClick={() => openEditLinkModal(collectionId, link.id)}
          disabled={isDraggingExternalItem || readOnly}
        >
          <Edit3 className='h-3 w-3 text-muted-foreground' />
        </Button>
      </div>
    </div>
  );
}
