/**
 * Draggable Tab Component
 * Enables dragging Chrome tabs to collections
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { ExternalLink, X, GripVertical } from 'lucide-react';
import Image from 'next/image';
import type { ChromeTabInfo } from '@/types';
import { useFavicon } from '@/hooks/useFavicon';
import { convertChromeFaviconUrl } from '@/lib/faviconService';

interface DraggableTabProps {
  tab: ChromeTabInfo;
  onTabClick: (tabId: number) => void;
  onCloseTab: (tabId: number, event: React.MouseEvent) => void;
  isDragOverlay?: boolean;
  activeProjectId: string | null;
}

export function DraggableTab({
  tab,
  onTabClick,
  onCloseTab,
  isDragOverlay = false,
  activeProjectId,
}: DraggableTabProps) {
  const { favicon } = useFavicon(tab.url);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `tab-${tab.id}`,
      data: {
        type: 'tab',
        tab,
        projectId: activeProjectId,
      },
      disabled: !activeProjectId,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger click if dragging or clicking on action buttons
    if (isDragging || (e.target as HTMLElement).closest('button')) {
      return;
    }
    onTabClick(tab.id);
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
      title={`Click to switch to: ${tab.title}`}
    >
      {/* Drag handle */}
      <div
        {...listeners}
        {...attributes}
        className='cursor-grab active:cursor-grabbing opacity-60 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary/50 rounded'
        title='Drag to collection'
      >
        <GripVertical className='h-4 w-4 text-muted-foreground' />
      </div>

      {/* Favicon */}
      <Image
        src={convertChromeFaviconUrl(tab.favIconUrl || favicon)}
        alt='favicon'
        width={16}
        height={16}
        className='rounded shrink-0'
        onError={(e) =>
          (e.currentTarget.src = 'https://placehold.co/16x16.png')
        }
        unoptimized
      />

      {/* Tab title */}
      <div className='flex-1 truncate text-foreground' title={tab.url}>
        {tab.title.length > 30 ? `${tab.title.substring(0, 30)}...` : tab.title}
      </div>

      {/* Action buttons */}
      <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='h-5 w-5'
          onClick={(e) => {
            e.stopPropagation();
            window.open(tab.url, '_blank');
          }}
          title='Open in new tab'
        >
          <ExternalLink className='h-3 w-3 text-muted-foreground' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-5 w-5 hover:bg-red-100 hover:text-red-600'
          onClick={(e) => onCloseTab(tab.id, e)}
          title='Close tab'
        >
          <X className='h-3 w-3' />
        </Button>
      </div>
    </div>
  );
}

/**
 * Drag overlay component for tabs
 */
export function TabDragOverlay({ tab }: { tab: ChromeTabInfo }) {
  const { favicon } = useFavicon(tab.url);

  return (
    <div className='flex items-center gap-2 p-1.5 bg-background rounded-md border border-primary shadow-lg text-xs max-w-xs'>
      <GripVertical className='h-4 w-4 text-muted-foreground' />
      <Image
        src={convertChromeFaviconUrl(tab.favIconUrl || favicon)}
        alt='favicon'
        width={16}
        height={16}
        className='rounded shrink-0'
        onError={(e) =>
          (e.currentTarget.src = 'https://placehold.co/16x16.png')
        }
        unoptimized
      />
      <div className='truncate text-foreground' title={tab.title}>
        {tab.title.length > 30 ? `${tab.title.substring(0, 30)}...` : tab.title}
      </div>
    </div>
  );
}
