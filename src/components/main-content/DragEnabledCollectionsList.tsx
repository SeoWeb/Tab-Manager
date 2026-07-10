import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Image from 'next/image';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  SortableCollectionItem,
  CollectionDropPlaceholder,
} from '@/components/drag-drop';
import AddCollectionButton from './AddCollectionButton';
import type { Project } from '@/types';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useAppStore } from '@/stores/appStore';
import { useDragAndDropContext } from '@/components/drag-drop/GlobalDragDropProvider';

interface DragEnabledCollectionsListProps {
  project: Project;
}

export function DragEnabledCollectionsList({
  project,
}: DragEnabledCollectionsListProps) {
  const [focusedCollectionIndex, setFocusedCollectionIndex] = useState(-1);
  const migrateCollectionOrder = useAppStore(
    (state) => state.migrateCollectionOrder
  );
  const { collectionDropPlaceholder } = useDragAndDropContext();

  // Ensure collections have proper order values for drag and drop
  useEffect(() => {
    if (project.collections.length > 0) {
      migrateCollectionOrder(project.id);
    }
  }, [project.id, project.collections.length, migrateCollectionOrder]);

  // Sort collections by order if needed, default to array order for now
  const sortedCollections = useMemo(
    () =>
      [...project.collections].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [project.collections]
  );

  const handleNavigation = useCallback(
    (direction: 'left' | 'right') => {
      if (sortedCollections.length === 0) return;
      const newIndex =
        direction === 'left'
          ? Math.max(0, focusedCollectionIndex - 1)
          : Math.min(sortedCollections.length - 1, focusedCollectionIndex + 1);
      setFocusedCollectionIndex(newIndex);
    },
    [focusedCollectionIndex, sortedCollections.length]
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

  const collectionIds = sortedCollections.map((collection) => collection.id);

  return (
    <SortableContext
      items={collectionIds}
      strategy={verticalListSortingStrategy}
    >
      <div className='space-y-2'>
        {sortedCollections.map((collection, index) => (
          <div key={collection.id}>
            {/* Show placeholder before this collection if needed */}
            <CollectionDropPlaceholder
              isVisible={
                collectionDropPlaceholder?.projectId === project.id &&
                collectionDropPlaceholder?.position === index
              }
            />
            <div
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
          </div>
        ))}
        {/* Show placeholder at the end if needed */}
        <CollectionDropPlaceholder
          isVisible={
            collectionDropPlaceholder?.projectId === project.id &&
            collectionDropPlaceholder?.position === sortedCollections.length
          }
        />
        <div className='mt-6'>
          <AddCollectionButton />
        </div>
      </div>
    </SortableContext>
  );
}

export default DragEnabledCollectionsList;
