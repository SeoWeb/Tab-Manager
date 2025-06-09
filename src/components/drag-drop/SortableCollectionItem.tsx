import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragEnabledCollection from './DragEnabledCollection';
import type { Collection as CollectionType } from '@/types';

interface SortableCollectionItemProps {
  collection: CollectionType;
  projectId: string;
}

export function SortableCollectionItem({
  collection,
  projectId,
}: SortableCollectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: collection.id,
    data: {
      type: 'collection',
      projectId,
      collection,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? 'z-50' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className='cursor-grab active:cursor-grabbing'
      >
        <DragEnabledCollection collection={collection} projectId={projectId} />
      </div>
    </div>
  );
}
