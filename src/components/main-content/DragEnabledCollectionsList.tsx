import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableCollectionItem } from '@/components/drag-drop';
import AddCollectionButton from './AddCollectionButton';
import type { Project } from '@/types';
import { useHotkeys } from '@/hooks/useHotkeys';

interface DragEnabledCollectionsListProps {
  project: Project;
}

export function DragEnabledCollectionsList({
  project,
}: DragEnabledCollectionsListProps) {
  const [focusedCollectionIndex, setFocusedCollectionIndex] = useState(-1);

  const handleNavigation = useCallback(
    (direction: 'left' | 'right') => {
      if (project.collections.length === 0) return;
      const newIndex =
        direction === 'left'
          ? Math.max(0, focusedCollectionIndex - 1)
          : Math.min(
              project.collections.length - 1,
              focusedCollectionIndex + 1
            );
      setFocusedCollectionIndex(newIndex);
    },
    [focusedCollectionIndex, project.collections.length]
  );

  useHotkeys('left', () => handleNavigation('left'));
  useHotkeys('right', () => handleNavigation('right'));

  if (project.collections.length === 0) {
    return (
      <div className='text-center py-10'>
        <Image
          src='https://placehold.co/200x150.png?text=No+Collections'
          alt='No collections'
          width={200}
          height={150}
          className='mx-auto mb-4 rounded-md'
          data-ai-hint='empty state illustration'
        />
        <p className='text-muted-foreground mb-4'>
          This project has no collections yet.
        </p>
        <AddCollectionButton />
      </div>
    );
  }

  // Sort collections by order if needed, default to array order for now
  const sortedCollections = [...project.collections].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );
  const collectionIds = sortedCollections.map((collection) => collection.id);

  return (
    <SortableContext
      items={collectionIds}
      strategy={verticalListSortingStrategy}
    >
      <div className='space-y-2'>
        {sortedCollections.map((collection, index) => (
          <div
            key={collection.id}
            className={
              index === focusedCollectionIndex
                ? 'ring-2 ring-primary rounded-lg'
                : ''
            }
          >
            <SortableCollectionItem
              collection={collection}
              projectId={project.id}
            />
          </div>
        ))}
        <div className='mt-6'>
          <AddCollectionButton />
        </div>
      </div>
    </SortableContext>
  );
}

export default DragEnabledCollectionsList;
