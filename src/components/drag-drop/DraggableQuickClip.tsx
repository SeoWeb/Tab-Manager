/**
 * Draggable Quick Clip Component
 * Enables dragging a clip from the Quick Clips panel into a collection.
 * Mirrors DraggableTab but is not gated by an active project and carries a
 * `quickClip` payload so the drop handler can remove it after a successful drop.
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { ExternalLink, X, GripVertical } from 'lucide-react';
import Image from 'next/image';
import type { QuickClip } from '@/lib/quickClips';
import { useFavicon } from '@/hooks/useFavicon';
import { convertChromeFaviconUrl } from '@/lib/faviconService';

interface DraggableQuickClipProps {
  clip: QuickClip;
  onOpen?: (url: string) => void;
  onRemove?: (id: string) => void;
  isDragOverlay?: boolean;
}

export function DraggableQuickClip({
  clip,
  onOpen,
  onRemove,
  isDragOverlay = false,
}: DraggableQuickClipProps) {
  const { favicon } = useFavicon(clip.url);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `quickclip-${clip.id}`,
      data: {
        type: 'quickClip',
        quickClip: {
          id: clip.id,
          title: clip.title,
          url: clip.url,
          favIconUrl: clip.favIconUrl,
        },
        clipId: clip.id,
      },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging || (e.target as HTMLElement).closest('button')) {
      return;
    }
    onOpen?.(clip.url);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 p-1.5 bg-background hover:bg-secondary/50 rounded-md border border-input text-xs group cursor-pointer
        ${isDragging ? 'opacity-50' : ''}
        ${isDragOverlay ? 'shadow-lg border-primary' : ''}
      `}
      onClick={handleClick}
      title={`Click to open: ${clip.title}`}
    >
      {/* Drag handle */}
      <div
        {...listeners}
        {...attributes}
        className='cursor-grab active:cursor-grabbing opacity-60 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary/50 rounded'
        title='Drag to a collection'
      >
        <GripVertical className='h-4 w-4 text-muted-foreground' />
      </div>

      {/* Favicon */}
      <Image
        src={convertChromeFaviconUrl(clip.favIconUrl || favicon)}
        alt='favicon'
        width={16}
        height={16}
        className='rounded shrink-0'
        onError={(e) =>
          (e.currentTarget.src = 'https://placehold.co/16x16.png')
        }
        unoptimized
      />

      {/* Clip title */}
      <div className='flex-1 truncate text-foreground' title={clip.url}>
        {clip.title.length > 30
          ? `${clip.title.substring(0, 30)}...`
          : clip.title}
      </div>

      {/* Action buttons */}
      <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='h-5 w-5'
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.(clip.url);
          }}
          title='Open in new tab'
        >
          <ExternalLink className='h-3 w-3 text-muted-foreground' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-5 w-5 hover:bg-red-100 hover:text-red-600'
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.(clip.id);
          }}
          title='Remove clip'
        >
          <X className='h-3 w-3' />
        </Button>
      </div>
    </div>
  );
}

/**
 * Drag overlay component for quick clips.
 */
export function QuickClipDragOverlay({ clip }: { clip: QuickClip }) {
  const { favicon } = useFavicon(clip.url);

  return (
    <div className='flex items-center gap-2 p-1.5 bg-background rounded-md border border-primary shadow-lg text-xs max-w-xs'>
      <GripVertical className='h-4 w-4 text-muted-foreground' />
      <Image
        src={convertChromeFaviconUrl(clip.favIconUrl || favicon)}
        alt='favicon'
        width={16}
        height={16}
        className='rounded shrink-0'
        onError={(e) =>
          (e.currentTarget.src = 'https://placehold.co/16x16.png')
        }
        unoptimized
      />
      <div className='truncate text-foreground' title={clip.title}>
        {clip.title.length > 30
          ? `${clip.title.substring(0, 30)}...`
          : clip.title}
      </div>
    </div>
  );
}
