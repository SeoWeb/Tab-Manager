import type { Project, Collection, Link } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import type { StoreApi } from 'zustand';

/**
 * Enqueue an `update` mutation for every link in a collection carrying its
 * current order. Reorder is last-write-wins per link, so pushing the whole
 * collection's order keeps sibling ordering consistent across clients.
 */
function syncLinkOrders(
  projectId: string,
  collection: Collection | undefined
): void {
  if (!collection) return;
  for (const link of collection.links) {
    void enqueueCloudChange({
      projectId,
      entityType: 'link',
      entityId: link.id,
      operation: 'update',
      patch: { order: link.order ?? 0 },
    });
  }
}

/** Enqueue an `update` mutation for every collection's current order. */
function syncCollectionOrders(
  projectId: string,
  collections: Collection[]
): void {
  for (const collection of collections) {
    void enqueueCloudChange({
      projectId,
      entityType: 'collection',
      entityId: collection.id,
      operation: 'update',
      patch: { order: collection.order ?? 0 },
    });
  }
}

export const createDragDropActions = (
  set: StoreApi<AppState>['setState'],
  get: () => AppState
) => ({
  moveLink: (
    projectId: string,
    sourceCollectionId: string,
    linkId: string,
    targetCollectionId: string,
    position?: number
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;

      const sourceCollection = project.collections.find(
        (c: Collection) => c.id === sourceCollectionId
      );
      const targetCollection = project.collections.find(
        (c: Collection) => c.id === targetCollectionId
      );

      if (!sourceCollection || !targetCollection) return state;

      const linkToMove = sourceCollection.links.find(
        (l: Link) => l.id === linkId
      );
      if (!linkToMove) return state;

      // Check if link already exists in target collection (prevent duplicates)
      const linkExists = targetCollection.links.some(
        (l: Link) => l.url === linkToMove.url
      );
      if (linkExists) {
        console.warn('Link already exists in target collection');
        return state;
      }

      // --- Bookmark Logic ---
      if (linkToMove.bookmarkId && targetCollection.bookmarkFolderId) {
        (async () => {
          try {
            // Create a new bookmark in the target folder
            const newBookmark = await bookmarkStorage.createLink(
              linkToMove.title!,
              linkToMove.url,
              targetCollection.bookmarkFolderId!
            );

            // Delete the old bookmark
            await bookmarkStorage.deleteLink(linkToMove.bookmarkId!);

            // Update the link's bookmarkId in the state
            get().updateLink(
              projectId,
              targetCollectionId,
              linkId,
              { bookmarkId: newBookmark.id },
              true // isInternalCall
            );
          } catch (error) {
            console.error('Failed to move bookmark:', error);
          }
        })();
      }
      // --- End Bookmark Logic ---

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === sourceCollectionId) {
                // Remove link from source collection
                return {
                  ...c,
                  links: c.links.filter((l: Link) => l.id !== linkId),
                  updatedAt: new Date(),
                };
              } else if (c.id === targetCollectionId) {
                // Add link to target collection at the specified position
                const newLinks = [...c.links];
                const newLink = { ...linkToMove };
                if (position !== undefined) {
                  newLinks.splice(position, 0, newLink);
                } else {
                  newLinks.push(newLink);
                }
                // Update order for all links in the target collection.
                // Bump `updatedAt` on any link whose order actually changes
                // (and the moved link, whose collection changed) so
                // last-write-wins reconciliation treats the reorder as a fresh
                // local edit rather than a stale row.
                const reorderedLinks = newLinks.map((link, index) => {
                  const orderChanged = (link.order ?? index) !== index;
                  const isMovedLink = link.id === linkId;
                  return {
                    ...link,
                    order: index,
                    ...(orderChanged || isMovedLink
                      ? { updatedAt: new Date() }
                      : {}),
                  };
                });
                return {
                  ...c,
                  links: reorderedLinks,
                  updatedAt: new Date(),
                };
              }
              return c;
            }),
            updatedAt: new Date(),
          };
        }
        return p;
      });

      return { projects: updatedProjects };
    });

    // Push the move to the cloud: the moved link's new collection + order, plus
    // the shifted orders in both source and target collections.
    const movedProject = get().projects.find((p) => p.id === projectId);
    const target = movedProject?.collections.find(
      (c) => c.id === targetCollectionId
    );
    const source = movedProject?.collections.find(
      (c) => c.id === sourceCollectionId
    );
    const movedLink = target?.links.find((l) => l.id === linkId);
    if (movedLink) {
      void enqueueCloudChange({
        projectId,
        entityType: 'link',
        entityId: linkId,
        operation: 'update',
        patch: {
          collectionId: targetCollectionId,
          order: movedLink.order ?? 0,
        },
      });
    }
    if (sourceCollectionId !== targetCollectionId) {
      syncLinkOrders(projectId, source);
    }
    syncLinkOrders(projectId, target);
  },

  reorderLinks: (
    projectId: string,
    collectionId: string,
    activeLinkId: string,
    overLinkId: string
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;

      const collection = project.collections.find(
        (c: Collection) => c.id === collectionId
      );
      if (!collection) return state;

      const activeIndex = collection.links.findIndex(
        (l: Link) => l.id === activeLinkId
      );
      const overIndex = collection.links.findIndex(
        (l: Link) => l.id === overLinkId
      );

      if (activeIndex === -1 || overIndex === -1) return state;

      const movedLink = collection.links[activeIndex];

      // --- Bookmark Logic ---
      if (movedLink.bookmarkId && collection.bookmarkFolderId) {
        (async () => {
          try {
            await bookmarkStorage.moveBookmark(movedLink.bookmarkId!, {
              index: overIndex,
            });
          } catch (error) {
            console.error('Failed to move bookmark:', error);
          }
        })();
      }
      // --- End Bookmark Logic ---

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === collectionId) {
                const newLinks = [...c.links];
                const [splicedLink] = newLinks.splice(activeIndex, 1);
                newLinks.splice(overIndex, 0, splicedLink);

                // Update order values. Bump `updatedAt` on any link whose
                // order actually changes so last-write-wins reconciliation
                // treats the reorder as a fresh local edit rather than a stale
                // row.
                const reorderedLinks = newLinks.map(
                  (link: Link, index: number) => ({
                    ...link,
                    order: index,
                    ...((link.order ?? index) !== index
                      ? { updatedAt: new Date() }
                      : {}),
                  })
                );

                return {
                  ...c,
                  links: reorderedLinks,
                  updatedAt: new Date(),
                };
              }
              return c;
            }),
            updatedAt: new Date(),
          };
        }
        return p;
      });

      return { projects: updatedProjects };
    });

    // Push the reordered link orders to the cloud.
    const project = get().projects.find((p) => p.id === projectId);
    const collection = project?.collections.find((c) => c.id === collectionId);
    syncLinkOrders(projectId, collection);
  },

  reorderCollections: (
    projectId: string,
    activeCollectionId: string,
    overCollectionId: string
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;

      const activeIndex = project.collections.findIndex(
        (c: Collection) => c.id === activeCollectionId
      );
      const overIndex = project.collections.findIndex(
        (c: Collection) => c.id === overCollectionId
      );

      if (activeIndex === -1 || overIndex === -1) return state;

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          const newCollections = [...p.collections];
          const [movedCollection] = newCollections.splice(activeIndex, 1);
          newCollections.splice(overIndex, 0, movedCollection);

          // Update order values
          const reorderedCollections = newCollections.map(
            (collection: Collection, index: number) => ({
              ...collection,
              order: index,
            })
          );

          return {
            ...p,
            collections: reorderedCollections,
            updatedAt: new Date(),
          };
        }
        return p;
      });

      return { projects: updatedProjects };
    });

    // Push the reordered collection orders to the cloud.
    const project = get().projects.find((p) => p.id === projectId);
    if (project) syncCollectionOrders(projectId, project.collections);
  },
});
