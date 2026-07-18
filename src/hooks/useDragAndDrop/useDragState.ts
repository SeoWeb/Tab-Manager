import { useState, useCallback } from 'react';
import { DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { useAppStore } from '@/stores/appStore';
import type {
  DragItem,
  CollectionDropPlaceholder,
  LinkDropPlaceholder,
} from './types';

export function useDragState() {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [collectionDropPlaceholder, setCollectionDropPlaceholder] =
    useState<CollectionDropPlaceholder | null>(null);

  const [linkDropPlaceholder, setLinkDropPlaceholder] =
    useState<LinkDropPlaceholder | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const { id, data } = active;
    const current = data.current;

    if (
      current &&
      current.type &&
      (typeof current.projectId === 'string' ||
        typeof current.clipId === 'string')
    ) {
      const { type, projectId, ...restData } = current;
      setActiveItem({
        id: id.toString(),
        type: type,
        data: {
          projectId: projectId,
          ...restData,
        },
      });

      // Reset drop placeholder when starting a new drag
      setCollectionDropPlaceholder(null);
      setLinkDropPlaceholder(null);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;

      if (!over || !activeItem) {
        if (collectionDropPlaceholder) setCollectionDropPlaceholder(null);
        if (linkDropPlaceholder) setLinkDropPlaceholder(null);
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const overData = over.data.current;

      // Clear placeholders if not dragging a relevant type
      if (
        activeItem.type !== 'collection' &&
        activeItem.type !== 'link' &&
        activeItem.type !== 'project'
      ) {
        if (collectionDropPlaceholder) setCollectionDropPlaceholder(null);
        if (linkDropPlaceholder) setLinkDropPlaceholder(null);
        return;
      }

      if (activeItem.type === 'collection') {
        if (linkDropPlaceholder) setLinkDropPlaceholder(null);
        // Collection drag over logic...
        if (overData?.type !== 'collection' && overData?.type !== 'link') {
          return;
        }
        let targetCollectionId = overId;
        if (overData?.type === 'link' && overData?.collectionId) {
          targetCollectionId = overData.collectionId;
        } else if (overData?.type === 'collection') {
          targetCollectionId = overData.collectionId || overId;
        }
        if (activeId === targetCollectionId) {
          setCollectionDropPlaceholder(null);
          return;
        }
        const projectId = activeItem.data.projectId;
        const { projects } = useAppStore.getState();
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;
        const sortedCollections = [...project.collections].sort(
          (a, b) => (a.order || 0) - (b.order || 0)
        );
        const activeIndex = sortedCollections.findIndex(
          (c) => c.id === activeId
        );
        const targetIndex = sortedCollections.findIndex(
          (c) => c.id === targetCollectionId
        );
        if (activeIndex === -1 || targetIndex === -1) return;
        const dropPosition =
          activeIndex < targetIndex ? targetIndex + 1 : targetIndex;
        setCollectionDropPlaceholder({
          projectId,
          position: dropPosition,
          targetCollectionId,
        });
      } else if (activeItem.type === 'link') {
        if (collectionDropPlaceholder) setCollectionDropPlaceholder(null);
        // Link drag over logic...
        const { projectId, collectionId: sourceCollectionId } = activeItem.data;
        let targetCollectionId: string | undefined;
        let targetLinkId: string | undefined;
        let position: number | undefined;

        if (overData?.type === 'collection') {
          targetCollectionId = overData.collectionId;
        } else if (overData?.type === 'link') {
          targetCollectionId = overData.collectionId;
          targetLinkId = overId;
        }

        if (!targetCollectionId) {
          if (linkDropPlaceholder) setLinkDropPlaceholder(null);
          return;
        }

        const { projects } = useAppStore.getState();
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;

        const sourceCollection = project.collections.find(
          (c) => c.id === sourceCollectionId
        );
        const targetCollection = project.collections.find(
          (c) => c.id === targetCollectionId
        );

        if (!sourceCollection || !targetCollection) return;

        // Prevent dropping if the URL already exists in the target collection
        const activeLink = sourceCollection.links.find(
          (l) => l.id === activeId
        );
        if (
          activeLink &&
          targetCollection.links.some((l) => l.url === activeLink.url)
        ) {
          if (linkDropPlaceholder) setLinkDropPlaceholder(null);
          return;
        }

        if (targetLinkId) {
          const sortedLinks = [...targetCollection.links].sort(
            (a, b) => (a.order || 0) - (b.order || 0)
          );
          const targetIndex = sortedLinks.findIndex(
            (l) => l.id === targetLinkId
          );
          if (targetIndex !== -1) {
            position = targetIndex;
          }
        } else {
          // If dropping on the collection but not on a specific link, drop at the end
          position = targetCollection.links.length;
        }

        if (position === undefined) {
          if (linkDropPlaceholder) setLinkDropPlaceholder(null);
          return;
        }

        setLinkDropPlaceholder({
          projectId,
          collectionId: targetCollectionId,
          position: position,
          targetLinkId: targetLinkId || '',
        });
      }
    },
    [activeItem, collectionDropPlaceholder, linkDropPlaceholder]
  );

  return {
    activeItem,
    collectionDropPlaceholder,
    linkDropPlaceholder,
    setActiveItem,
    setCollectionDropPlaceholder,
    setLinkDropPlaceholder,
    handleDragStart,
    handleDragOver,
  };
}
