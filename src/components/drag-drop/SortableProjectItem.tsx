import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ProjectItem from '../left-sidebar/ProjectItem';
import type { Project } from '@/types';
import { useDragAndDropContext } from './GlobalDragDropProvider';

interface SortableProjectItemProps {
  project: Project;
}

export function SortableProjectItem({ project }: SortableProjectItemProps) {
  const { activeItem } = useDragAndDropContext();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: project.id,
    data: {
      type: 'project',
      project,
      projectId: project.id,
    },
  });

  // Check if there's an active drag operation for projects
  const isDragActive =
    activeItem?.type === 'project' && activeItem.id !== project.id;

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
      } ${isOver && activeItem?.type === 'project' ? 'ring-2 ring-blue-400 ring-opacity-50 rounded-lg' : ''}`}
    >
      <ProjectItem
        project={project}
        showDragHandle={true}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
