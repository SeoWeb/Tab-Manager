import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDndContext } from '@dnd-kit/core';
import LinkItem from '@/components/main-content/LinkItem';
import type { Link } from '@/types';

interface SortableLinkItemProps {
  link: Link;
  projectId: string;
  collectionId: string;
}

export const SortableLinkItem = React.memo(function SortableLinkItem({
  link,
  projectId,
  collectionId,
}: SortableLinkItemProps) {
  const { active } = useDndContext();

  // Check if we're dragging an external item (tab/bookmark)
  const isDraggingExternalItem =
    active?.data?.current?.type === 'tab' ||
    active?.data?.current?.type === 'bookmark';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: link.id,
    data: {
      type: 'link',
      projectId,
      collectionId,
      link,
    },
    disabled: isDraggingExternalItem, // Disable sortable when dragging external items
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // When dragging external items, render without sortable functionality
  if (isDraggingExternalItem) {
    return (
      <div style={{ opacity: 0.75 }}>
        <LinkItem
          link={link}
          projectId={projectId}
          collectionId={collectionId}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'z-50' : ''}>
      <LinkItem
        link={link}
        projectId={projectId}
        collectionId={collectionId}
        showDragHandle={true}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
});
