import { useState, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  KeyboardSensor,
  TouchSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useAppStore } from '@/stores/appStore';

export interface DragItem {
  id: string;
  type: 'link' | 'collection' | 'tab';
  data: {
    projectId: string;
    collectionId?: string;
    link?: {
      id: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };
    collection?: {
      id: string;
      name: string;
      links: Array<{
        id: string;
        title: string;
        url: string;
        favIconUrl?: string;
      }>;
    };
    [key: string]: unknown;
  };
}

export function useDragAndDrop() {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const { moveLink, reorderCollections, reorderLinks } = useAppStore(
    (state) => ({
      moveLink: state.moveLink,
      reorderCollections: state.reorderCollections,
      reorderLinks: state.reorderLinks,
    })
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const dragItem = active.data.current as DragItem;
    setActiveItem(dragItem);
  }, []);

  const handleDragOver = useCallback(() => {
    // Handle drag over logic for visual feedback
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || !activeItem) {
        setActiveItem(null);
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const overData = over.data.current;

      // Handle different drag scenarios
      if (activeItem.type === 'link') {
        if (overData?.type === 'collection') {
          // Moving link to different collection
          const { projectId, collectionId: sourceCollectionId } =
            activeItem.data;
          const targetCollectionId = overData.collectionId;

          if (sourceCollectionId && sourceCollectionId !== targetCollectionId) {
            moveLink(
              projectId,
              sourceCollectionId,
              activeId,
              targetCollectionId
            );
          }
        } else if (overData?.type === 'link') {
          // Reordering links within collection
          const { projectId, collectionId } = activeItem.data;
          if (collectionId) {
            reorderLinks(projectId, collectionId, activeId, overId);
          }
        }
      } else if (activeItem.type === 'collection') {
        if (overData?.type === 'collection') {
          // Reordering collections
          const { projectId } = activeItem.data;
          reorderCollections(projectId, activeId, overId);
        }
      }

      setActiveItem(null);
    },
    [activeItem, moveLink, reorderCollections, reorderLinks]
  );

  return {
    sensors,
    activeItem,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}

export {
  DndContext,
  DragOverlay,
  SortableContext,
  verticalListSortingStrategy,
};
