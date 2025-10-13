import { useState, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
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
import { createLinkDataFromTab } from '@/lib/faviconUtils';

export interface DragItem {
  id: string;
  type: 'link' | 'collection' | 'tab' | 'bookmark' | 'project';
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
    project?: {
      id: string;
      name: string;
      color?: string;
      icon?: string;
    };
    tab?: {
      id: number;
      title: string;
      url: string;
      favIconUrl?: string;
      windowId: number;
    };
    bookmark?: {
      id: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };
    [key: string]: unknown;
  };
}

export function useDragAndDrop() {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [collectionDropPlaceholder, setCollectionDropPlaceholder] = useState<{
    projectId: string;
    position: number; // Index where the placeholder should appear
    targetCollectionId: string; // Collection being hovered over
  } | null>(null);

  const [linkDropPlaceholder, setLinkDropPlaceholder] = useState<{
    projectId: string;
    collectionId: string;
    position: number;
    targetLinkId: string;
  } | null>(null);

  const {
    moveLink,
    reorderCollections,
    reorderLinks,
    addLink,
    reorderProjects,
  } = useAppStore((state) => ({
    moveLink: state.moveLink,
    reorderCollections: state.reorderCollections,
    reorderLinks: state.reorderLinks,
    addLink: state.addLink,
    reorderProjects: state.reorderProjects,
  }));

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
    const { id, data } = active;
    const current = data.current;

    if (current && current.type && typeof current.projectId === 'string') {
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

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || !activeItem) {
        setActiveItem(null);
        setCollectionDropPlaceholder(null);
        setLinkDropPlaceholder(null);
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const overData = over.data.current;

      // Handle different drag scenarios
      if (activeItem.type === 'link') {
        const { projectId, collectionId: sourceCollectionId } = activeItem.data;
        let targetCollectionId: string | undefined;

        if (overData?.type === 'collection') {
          targetCollectionId = overData.collectionId;
        } else if (overData?.type === 'link') {
          targetCollectionId = overData.collectionId;
        }

        if (
          sourceCollectionId &&
          targetCollectionId &&
          sourceCollectionId !== targetCollectionId
        ) {
          // Moving link to a different collection
          const { projects } = useAppStore.getState();
          const project = projects.find((p) => p.id === projectId);
          const sourceCollection = project?.collections.find(
            (c) => c.id === sourceCollectionId
          );
          const targetCollection = project?.collections.find(
            (c) => c.id === targetCollectionId
          );
          const linkToMove = sourceCollection?.links.find(
            (l) => l.id === activeId
          );

          if (
            linkToMove &&
            !targetCollection?.links.some((l) => l.url === linkToMove.url)
          ) {
            moveLink(
              projectId,
              sourceCollectionId,
              activeId,
              targetCollectionId,
              linkDropPlaceholder?.position
            );
          }
        } else if (
          sourceCollectionId &&
          targetCollectionId &&
          sourceCollectionId === targetCollectionId &&
          activeId !== overId
        ) {
          // Reordering links within the same collection
          reorderLinks(projectId, sourceCollectionId, activeId, overId);
        }
      } else if (activeItem.type === 'collection') {
        // Reordering collections
        console.log('Collection drag end - Debug info:', {
          activeId,
          overId,
          overData,
          activeItem,
          isDifferent: activeId !== overId,
        });

        if (activeId !== overId) {
          const { projectId } = activeItem.data;

          // If we're dropping on a link, get the collection ID from the overData
          let targetCollectionId = overId;
          if (overData?.type === 'link' && overData?.collectionId) {
            targetCollectionId = overData.collectionId;
          } else if (overData?.type === 'collection') {
            targetCollectionId = overData.collectionId || overId;
          }

          console.log('Triggering reorderCollections:', {
            projectId,
            activeId,
            targetCollectionId,
            originalOverId: overId,
            overDataType: overData?.type,
          });

          reorderCollections(projectId, activeId, targetCollectionId);
        } else {
          console.log('Not reordering - same collection');
        }
      } else if (activeItem.type === 'tab') {
        if (overData?.type === 'collection') {
          // Adding Chrome tab to collection
          const tab = activeItem.data.tab;
          const projectId = overData.projectId;
          const collectionId = overData.collectionId || overData.collection?.id;

          if (tab && projectId && collectionId) {
            // Check if URL already exists in the collection
            const collection = overData.collection;
            const urlExists =
              collection?.links?.some(
                (link: { url: string }) => link.url === tab.url
              ) || false;

            if (!urlExists) {
              // Use the improved favicon service to preserve high-quality tab favicons
              const linkData = await createLinkDataFromTab(tab);

              addLink(projectId, collectionId, {
                title: linkData.title,
                url: linkData.url,
                favIconUrl: linkData.favIconUrl,
                tags: [],
                notes: '',
              });
            }
          }
        }
      } else if (activeItem.type === 'bookmark') {
        if (overData?.type === 'collection') {
          // Adding bookmark to collection
          const bookmark = activeItem.data.bookmark;
          const projectId = overData.projectId;
          const collectionId = overData.collectionId || overData.collection?.id;

          if (bookmark && projectId && collectionId) {
            // Check if URL already exists in the collection
            const collection = overData.collection;
            const urlExists =
              collection?.links?.some(
                (link: { url: string }) => link.url === bookmark.url
              ) || false;

            if (!urlExists) {
              // Use the improved favicon service for bookmarks as well
              const { preloadFavicon } = await import('@/lib/utils');
              const favIconUrl = bookmark.favIconUrl
                ? bookmark.favIconUrl
                : await preloadFavicon(bookmark.url);

              addLink(projectId, collectionId, {
                title: bookmark.title,
                url: bookmark.url,
                favIconUrl: favIconUrl,
                tags: [],
                notes: '',
              });
            }
          }
        }
      } else if (activeItem.type === 'project') {
        // Reordering projects
        if (activeId !== overId && overData?.type === 'project') {
          reorderProjects(activeId, overId);
        }
      }

      setActiveItem(null);
      setCollectionDropPlaceholder(null);
      setLinkDropPlaceholder(null);
    },
    [
      activeItem,
      moveLink,
      reorderCollections,
      reorderLinks,
      addLink,
      reorderProjects,
      linkDropPlaceholder,
    ]
  );

  return {
    sensors,
    activeItem,
    collectionDropPlaceholder,
    linkDropPlaceholder,
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
