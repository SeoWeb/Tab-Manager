import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragEnabledCollection from './DragEnabledCollection';
import { DroppableCollectionForTabs } from './DroppableCollectionForTabs';
import type { Collection as CollectionType } from '@/types';
import { useDragAndDropContext } from './GlobalDragDropProvider';

interface SortableCollectionItemProps {
  collection: CollectionType;
  projectId: string;
}

export function SortableCollectionItem({
  collection,
  projectId,
}: SortableCollectionItemProps) {
  const { collectionDropPlaceholder, activeItem } = useDragAndDropContext();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: collection.id,
    data: {
      type: 'collection',
      projectId,
      collection,
      collectionId: collection.id,
    },
  });

  // Check if there's an active drag operation for collections in this project
  const isDragActive =
    collectionDropPlaceholder &&
    collectionDropPlaceholder.projectId === projectId &&
    activeItem?.type === 'collection' &&
    activeItem.id !== collection.id;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? transition
      : isDragActive
        ? 'all 200ms ease-out'
        : transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? 'z-50' : ''} ${
        isDragActive ? 'transition-all duration-200 ease-out' : ''
      } ${isOver && activeItem?.type === 'collection' ? 'ring-2 ring-blue-400 ring-opacity-50 rounded-lg' : ''}`}
    >
      <DroppableCollectionForTabs collection={collection} projectId={projectId}>
        <DragEnabledCollection
          collection={collection}
          projectId={projectId}
          showDragHandle={true}
          dragHandleProps={{ ...attributes, ...listeners }}
        />
      </DroppableCollectionForTabs>
    </div>
  );
}
