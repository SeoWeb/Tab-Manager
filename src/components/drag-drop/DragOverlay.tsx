import React from 'react';
import { DragOverlay as DndKitDragOverlay } from '@dnd-kit/core';
import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, GripVertical } from 'lucide-react';
import type { DragItem } from '@/hooks/useDragAndDrop';
import { convertChromeFaviconUrl } from '@/lib/faviconService';

interface DragOverlayProps {
  activeItem: DragItem | null;
}

export function DragOverlay({ activeItem }: DragOverlayProps) {
  if (!activeItem) return null;

  const renderDragPreview = () => {
    if (activeItem.type === 'link') {
      const link = activeItem.data.link;
      if (!link) return null;

      return (
        <Card className='w-80 shadow-lg border-2 border-primary/50 bg-background/95 backdrop-blur'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-4 w-4 text-muted-foreground' />
              <div className='flex items-center gap-2 flex-1 min-w-0'>
                {link.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={convertChromeFaviconUrl(link.favIconUrl)}
                    alt=''
                    className='w-4 h-4 flex-shrink-0'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <ExternalLink className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                )}
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium truncate'>{link.title}</p>
                  <p className='text-xs text-muted-foreground truncate'>
                    {link.url}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (activeItem.type === 'collection') {
      const collection = activeItem.data.collection;
      if (!collection) return null;

      return (
        <Card className='w-96 shadow-lg border-2 border-blue-500 bg-blue-50/95 backdrop-blur animate-pulse'>
          <CardContent className='p-4'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-5 w-5 text-blue-600' />
              <div>
                <h3 className='font-semibold text-blue-800'>
                  📁 {collection.name}
                </h3>
                <p className='text-sm text-blue-600 font-medium'>
                  DRAGGING COLLECTION • {collection.links.length} link
                  {collection.links.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (activeItem.type === 'tab') {
      const tab = activeItem.data?.tab;
      if (!tab) return null;

      return (
        <Card className='w-80 shadow-lg border-2 border-primary/50 bg-background/95 backdrop-blur'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-4 w-4 text-muted-foreground' />
              <div className='flex items-center gap-2 flex-1 min-w-0'>
                {tab.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={convertChromeFaviconUrl(tab.favIconUrl)}
                    alt=''
                    className='w-4 h-4 flex-shrink-0 rounded'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <ExternalLink className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                )}
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium truncate'>{tab.title}</p>
                  <p className='text-xs text-muted-foreground truncate'>
                    {tab.url}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (activeItem.type === 'quickClip') {
      const clip = activeItem.data?.quickClip;
      if (!clip) return null;

      return (
        <Card className='w-80 shadow-lg border-2 border-primary/50 bg-background/95 backdrop-blur'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-4 w-4 text-muted-foreground' />
              <div className='flex items-center gap-2 flex-1 min-w-0'>
                {clip.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={convertChromeFaviconUrl(clip.favIconUrl)}
                    alt=''
                    className='w-4 h-4 flex-shrink-0 rounded'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <ExternalLink className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                )}
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium truncate'>{clip.title}</p>
                  <p className='text-xs text-muted-foreground truncate'>
                    {clip.url}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (activeItem.type === 'bookmark') {
      const bookmark = activeItem.data?.bookmark;
      if (!bookmark) return null;

      return (
        <Card className='w-80 shadow-lg border-2 border-primary/50 bg-background/95 backdrop-blur'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-4 w-4 text-muted-foreground' />
              <div className='flex items-center gap-2 flex-1 min-w-0'>
                {bookmark.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={convertChromeFaviconUrl(bookmark.favIconUrl)}
                    alt=''
                    className='w-4 h-4 flex-shrink-0 rounded'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <ExternalLink className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                )}
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium truncate'>
                    {bookmark.title}
                  </p>
                  <p className='text-xs text-muted-foreground truncate'>
                    {bookmark.url}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (activeItem.type === 'project') {
      const project = activeItem.data?.project;
      if (!project) return null;

      const initials = project.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

      return (
        <Card className='w-64 shadow-lg border-2 border-green-500 bg-green-50/95 backdrop-blur animate-pulse'>
          <CardContent className='p-4'>
            <div className='flex items-center gap-3'>
              <GripVertical className='h-5 w-5 text-green-600' />
              <div
                className='w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0'
                style={{ backgroundColor: project.color || '#CCCCCC' }}
              >
                {initials}
              </div>
              <div>
                <h3 className='font-semibold text-green-800'>{project.name}</h3>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  return <DndKitDragOverlay>{renderDragPreview()}</DndKitDragOverlay>;
}
