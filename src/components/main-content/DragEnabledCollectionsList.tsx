import React from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableCollectionItem } from '@/components/drag-drop';
import AddCollectionButton from './AddCollectionButton';
import type { Project } from '@/types';

interface DragEnabledCollectionsListProps {
  project: Project;
}

export function DragEnabledCollectionsList({
  project,
}: DragEnabledCollectionsListProps) {
  if (project.collections.length === 0) {
    return (
      <div className='text-center py-10'>
        <img
          src='https://placehold.co/200x150.png?text=No+Collections'
          alt='No collections'
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
      <div className='space-y-6'>
        {sortedCollections.map((collection) => (
          <SortableCollectionItem
            key={collection.id}
            collection={collection}
            projectId={project.id}
          />
        ))}
        <div className='mt-6'>
          <AddCollectionButton />
        </div>
      </div>
    </SortableContext>
  );
}

export default DragEnabledCollectionsList;
