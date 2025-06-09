import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import LinkItem from '@/components/main-content/LinkItem';
import type { Link } from '@/types';

interface SortableLinkItemProps {
  link: Link;
  projectId: string;
  collectionId: string;
}

export function SortableLinkItem({
  link,
  projectId,
  collectionId,
}: SortableLinkItemProps) {
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
      {...attributes}
      {...listeners}
      className={`cursor-grab active:cursor-grabbing ${
        isDragging ? 'z-50' : ''
      }`}
    >
      <LinkItem link={link} projectId={projectId} collectionId={collectionId} />
    </div>
  );
}
