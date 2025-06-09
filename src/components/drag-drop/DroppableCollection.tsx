import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableLinkItem } from './SortableLinkItem';
import type { Collection } from '@/types';

interface DroppableCollectionProps {
  collection: Collection;
  projectId: string;
  children?: React.ReactNode;
}

export function DroppableCollection({
  collection,
  projectId,
  children,
}: DroppableCollectionProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `collection-${collection.id}`,
    data: {
      type: 'collection',
      collectionId: collection.id,
      projectId,
    },
  });

  const linkIds = collection.links.map((link) => link.id);

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors duration-200 ${
        isOver
          ? 'bg-accent/20 border-accent border-2 border-dashed rounded-lg'
          : ''
      }`}
    >
      {children}
      <SortableContext items={linkIds} strategy={verticalListSortingStrategy}>
        <div className='space-y-3'>
          {collection.links.map((link) => (
            <SortableLinkItem
              key={link.id}
              link={link}
              projectId={projectId}
              collectionId={collection.id}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
