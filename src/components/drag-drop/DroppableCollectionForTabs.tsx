/**
 * Droppable Collection Component for Chrome Tabs
 * Allows dropping Chrome tabs into collections
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Collection } from '@/types';
import { cn } from '@/lib/utils';

interface DroppableCollectionForTabsProps {
  collection: Collection;
  projectId: string;
  children: React.ReactNode;
  onTabDrop?: (
    tabData: { id: string; title: string; url: string },
    collectionId: string,
    projectId: string
  ) => void;
}

export function DroppableCollectionForTabs({
  collection,
  projectId,
  children,
}: DroppableCollectionForTabsProps) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: `collection-${collection.id}`,
    data: {
      type: 'collection',
      collection,
      projectId,
    },
  });

  // Check if the active item is a tab
  const isTabBeingDragged = active?.data?.current?.type === 'tab';

  // Check if the tab URL already exists in this collection
  const tabUrl = active?.data?.current?.tab?.url;
  const urlExists =
    tabUrl && collection.links.some((link) => link.url === tabUrl);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative transition-all duration-200',
        isTabBeingDragged &&
          isOver &&
          !urlExists &&
          'ring-2 ring-primary ring-offset-2 bg-primary/5',
        isTabBeingDragged &&
          isOver &&
          urlExists &&
          'ring-2 ring-red-500 ring-offset-2 bg-red-500/20',
        isTabBeingDragged && !isOver && 'opacity-75'
      )}
    >
      {children}

      {/* Drop indicator overlay */}
      {isTabBeingDragged && isOver && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/80 rounded-md border-2 border-dashed border-primary z-10'>
          <div className='text-center p-4'>
            {urlExists ? (
              <div className='text-red-600'>
                <div className='font-medium'>URL already exists</div>
                <div className='text-sm'>
                  This link is already in this collection
                </div>
              </div>
            ) : (
              <div className='text-primary'>
                <div className='font-medium'>Drop to add tab</div>
                <div className='text-sm'>
                  Add &quot;{active?.data?.current?.tab?.title}&quot; to{' '}
                  {collection.name}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
