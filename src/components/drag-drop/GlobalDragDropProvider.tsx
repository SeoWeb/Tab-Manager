/**
 * Global Drag and Drop Provider
 * Provides a unified DndContext for the entire application
 * Handles dragging between main content and right panel
 */

import React, { createContext, useContext } from 'react';
import { DndContext } from '@dnd-kit/core';
import { useDragAndDrop, DragItem } from '@/hooks/useDragAndDrop';
import { DragOverlay } from './DragOverlay';

interface DragAndDropContextType {
  activeItem: DragItem | null;
  collectionDropPlaceholder: {
    projectId: string;
    position: number;
    targetCollectionId: string;
  } | null;
  linkDropPlaceholder: {
    projectId: string;
    collectionId: string;
    position: number;
    targetLinkId: string;
  } | null;
}

const DragAndDropContext = createContext<DragAndDropContextType | null>(null);

export const useDragAndDropContext = () => {
  const context = useContext(DragAndDropContext);
  if (!context) {
    throw new Error(
      'useDragAndDropContext must be used within a GlobalDragDropProvider'
    );
  }
  return context;
};

interface GlobalDragDropProviderProps {
  children: React.ReactNode;
}

export function GlobalDragDropProvider({
  children,
}: GlobalDragDropProviderProps) {
  const dragAndDrop = useDragAndDrop();

  const contextValue = {
    activeItem: dragAndDrop.activeItem,
    collectionDropPlaceholder: dragAndDrop.collectionDropPlaceholder,
    linkDropPlaceholder: dragAndDrop.linkDropPlaceholder,
  };

  return (
    <DndContext
      sensors={dragAndDrop.sensors}
      onDragStart={dragAndDrop.handleDragStart}
      onDragOver={dragAndDrop.handleDragOver}
      onDragEnd={dragAndDrop.handleDragEnd}
    >
      <DragAndDropContext.Provider value={contextValue}>
        {children}
      </DragAndDropContext.Provider>
      <DragOverlay activeItem={dragAndDrop.activeItem} />
    </DndContext>
  );
}
