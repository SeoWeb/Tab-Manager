import type { Project, Collection, Link } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { queueLinkBookmarkMove } from '@/lib/linkBookmarkMirror';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import type { StoreApi } from 'zustand';

/**
 * Find a link anywhere in a project, together with the collection currently
 * holding it. The bookmark-mirror plumbing must act on the link's CURRENT
 * collection and bookmark id — a queued mirror op can run after the link has
 * been optimistically moved again, and an earlier op in its chain may already
 * have replaced the bookmark the move started from.
 */
function findLinkLocation(
  project: Project | undefined,
  linkId: string
): { collection: Collection; link: Link } | undefined {
  for (const collection of project?.collections ?? []) {
    const link = collection.links.find((l: Link) => l.id === linkId);
    if (link) return { collection, link };
  }
  return undefined;
}

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

      // NOTE: the bookmark mirror is intentionally NOT started here. State
      // updaters must stay side-effect free, and the mirror has to be
      // sequenced with the `bookmarkId` it records — see the
      // `queueLinkBookmarkMove` call below the state commit.

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

    // --- Bookmark mirror (sequenced with the state it records) ---
    // The collection move above is optimistic; the bookmark mirror is tracked
    // and per-link serialized by `queueLinkBookmarkMove`. The new `bookmarkId`
    // reaches the store only after the mirrored bookmark exists in the target
    // folder AND the previous one was deleted, so a failed mirror can never
    // leave `bookmarkId` pointing at the wrong (or a nonexistent) bookmark —
    // see the ui-resilience requirement "No detached async mutations of
    // state-linked resources".
    //
    // The `source !== target` guard keeps the rejected same-collection move (a
    // no-op by the duplicate check above) from queueing a mirror. The mirror
    // request itself carries no snapshot: the op re-resolves the link's
    // current collection/bookmarkId when it reaches the front of its chain, so
    // a follow-up move of the same link always acts on the freshest mirror.
    if (
      sourceCollectionId !== targetCollectionId &&
      movedLink?.bookmarkId &&
      target?.bookmarkFolderId
    ) {
      const targetFolderId = target.bookmarkFolderId;
      void queueLinkBookmarkMove({
        linkId,
        targetFolderId,
        resolveMirror: () => {
          const current = findLinkLocation(
            get().projects.find((p) => p.id === projectId),
            linkId
          );
          if (!current || !current.link.bookmarkId) return null;
          return {
            oldBookmarkId: current.link.bookmarkId,
            title: current.link.title ?? '',
            url: current.link.url,
          };
        },
        commitBookmarkId: (newBookmarkId) => {
          const current = findLinkLocation(
            get().projects.find((p) => p.id === projectId),
            linkId
          );
          if (!current) return;
          get().updateLink(
            projectId,
            current.collection.id,
            linkId,
            { bookmarkId: newBookmarkId },
            true // isInternalCall
          );
        },
      });
    }
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

      // NOTE: the bookmark relocation is intentionally NOT started here —
      // state updaters must stay side-effect free. It runs after the state
      // commit below (a reorder does not change bookmark ids, so there is no
      // state-linked commit to sequence).

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

    // Bookmark mirror: a reorder only relocates the existing bookmark within
    // its folder (ids and the state's bookmarkId are unchanged), so unlike
    // `moveLink` there is no state-linked commit to sequence. The write stays
    // fire-and-forget, with failures logged.
    const movedLink = collection?.links.find(
      (l: Link) => l.id === activeLinkId
    );
    if (movedLink?.bookmarkId && collection?.bookmarkFolderId) {
      // After the reorder commit the moved link sits at the index of the link
      // it was dropped onto; resolve it from the committed state.
      const bookmarkId = movedLink.bookmarkId;
      const bookmarkIndex = collection.links.findIndex(
        (l: Link) => l.id === activeLinkId
      );
      (async () => {
        try {
          await bookmarkStorage.moveBookmark(bookmarkId, {
            index: bookmarkIndex,
          });
        } catch (error) {
          console.error('Failed to move bookmark:', error);
        }
      })();
    }

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
