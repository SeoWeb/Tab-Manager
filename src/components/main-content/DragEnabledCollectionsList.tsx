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
import { useVirtualScroll } from '@/lib/virtualScroll';
import { useHasHydrated } from '@/hooks/useAppStoreWithDefaults';
import { Skeleton } from '@/components/ui/skeleton';

interface DragEnabledCollectionsListProps {
  project: Project;
  /** External scroll container (e.g. the main content area) for windowing. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function DragEnabledCollectionsList({
  project,
  scrollRef,
}: DragEnabledCollectionsListProps) {
  const [focusedCollectionIndex, setFocusedCollectionIndex] = useState(-1);
  const migrateCollectionOrder = useAppStore(
    (state) => state.migrateCollectionOrder
  );
  const { collectionDropPlaceholder } = useDragAndDropContext();
  const _hasHydrated = useHasHydrated();

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

  const collectionIds = sortedCollections.map((collection) => collection.id);

  const { virtualizer } = useVirtualScroll<HTMLDivElement>({
    count: sortedCollections.length,
    estimateSize: () => 220,
    overscan: 6,
    getItemKey: (index) => sortedCollections[index]?.id ?? index,
    scrollRef,
  });

  const virtualItems = virtualizer.getVirtualItems();

  if (!_hasHydrated) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className='relative bg-secondary/50 rounded-lg border border-border p-4'
          >
            <div className='flex items-center gap-2 mb-3'>
              <Skeleton className='h-5 w-5 rounded' />
              <Skeleton className='h-4 w-40' />
              <div className='ml-auto flex gap-1'>
                <Skeleton className='h-6 w-6 rounded' />
                <Skeleton className='h-6 w-6 rounded' />
              </div>
            </div>
            <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2'>
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className='h-16 w-full rounded-md' />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

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

  return (
    <SortableContext
      items={collectionIds}
      strategy={verticalListSortingStrategy}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((vi) => {
          const collection = sortedCollections[vi.index];
          return (
            <div
              key={collection.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {/* Show placeholder before this collection if needed */}
              <CollectionDropPlaceholder
                isVisible={
                  collectionDropPlaceholder?.projectId === project.id &&
                  collectionDropPlaceholder?.position === vi.index
                }
              />
              <div
                className={
                  vi.index === focusedCollectionIndex
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
          );
        })}
      </div>
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
    </SortableContext>
  );
}

export default DragEnabledCollectionsList;
