/**
 * Global Drag and Drop Provider
 * Provides a unified DndContext for the entire application
 * Handles dragging between main content and right panel
 */

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { DragOverlay } from './DragOverlay';

interface GlobalDragDropProviderProps {
  children: React.ReactNode;
}

export function GlobalDragDropProvider({
  children,
}: GlobalDragDropProviderProps) {
  const {
    sensors,
    activeItem,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useDragAndDrop();

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay activeItem={activeItem} />
    </DndContext>
  );
}
