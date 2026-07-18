import { useCallback } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import { createLinkDataFromTab } from '@/lib/faviconUtils';
import { removeQuickClip } from '@/lib/quickClips';
import type {
  DragItem,
  CollectionDropPlaceholder,
  LinkDropPlaceholder,
} from './types';

interface DragEndDeps {
  activeItem: DragItem | null;
  linkDropPlaceholder: LinkDropPlaceholder | null;
  setActiveItem: (v: DragItem | null) => void;
  setCollectionDropPlaceholder: (v: CollectionDropPlaceholder | null) => void;
  setLinkDropPlaceholder: (v: LinkDropPlaceholder | null) => void;
}

export function useHandleDragEnd({
  activeItem,
  linkDropPlaceholder,
  setActiveItem,
  setCollectionDropPlaceholder,
  setLinkDropPlaceholder,
}: DragEndDeps) {
  const {
    moveLink,
    reorderCollections,
    reorderLinks,
    addLink,
    reorderProjects,
  } = useAppStore(
    useShallow((state) => ({
      moveLink: state.moveLink,
      reorderCollections: state.reorderCollections,
      reorderLinks: state.reorderLinks,
      addLink: state.addLink,
      reorderProjects: state.reorderProjects,
    }))
  );

  return useCallback(
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
      } else if (activeItem.type === 'quickClip') {
        if (overData?.type === 'collection') {
          // Filing a Quick Clips item into a collection, then removing it.
          const clip = activeItem.data.quickClip;
          const projectId = overData.projectId;
          const collectionId = overData.collectionId || overData.collection?.id;

          if (clip && projectId && collectionId) {
            const collection = overData.collection;
            const urlExists =
              collection?.links?.some(
                (link: { url: string }) => link.url === clip.url
              ) || false;

            if (!urlExists) {
              addLink(projectId, collectionId, {
                title: clip.title,
                url: clip.url,
                favIconUrl: clip.favIconUrl || '',
                tags: [],
                notes: '',
              });
              // Remove the clip from Quick Clips on a successful drop.
              const clipId = activeItem.data.clipId;
              if (clipId) {
                await removeQuickClip(clipId);
              }
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
}
