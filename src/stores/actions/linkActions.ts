import { nanoid } from 'nanoid';
import type { Link, Project, Collection } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { preloadFavicon } from '@/lib/utils';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import type { StoreApi } from 'zustand';

const generateId = () => nanoid();

/**
 * Build the cloud patch for a link update from local `updates`, keeping only
 * fields the Worker stores. Bookmark ids are device-local and excluded.
 */
function buildLinkUpdatePatch(
  updates: Partial<Link>
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (updates.url !== undefined) patch.url = updates.url;
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.favIconUrl !== undefined) patch.favIconUrl = updates.favIconUrl;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.tags !== undefined) patch.tags = updates.tags;
  if (updates.order !== undefined) patch.order = updates.order;
  return Object.keys(patch).length > 0 ? patch : null;
}

export const createLinkActions = (
  set: StoreApi<AppState>['setState'],
  get: () => AppState
) => ({
  addLink: (
    projectId: string,
    collectionId: string,
    linkData: Pick<Link, 'title' | 'url' | 'favIconUrl' | 'tags' | 'notes'>,
    skipBookmarkCreation = false
  ) => {
    const project = get().projects.find((p: Project) => p.id === projectId);
    if (!project) return;
    const collection = project.collections.find(
      (c: Collection) => c.id === collectionId
    );
    if (!collection) return;

    const newLink: Link = {
      id: generateId(),
      title: linkData.title || 'Untitled Link',
      url: linkData.url,
      favIconUrl: linkData.favIconUrl || '',
      tags: linkData.tags || [],
      notes: linkData.notes || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      order: collection.links.length,
      bookmarkId: null,
    };

    set((state: AppState) => {
      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === collectionId) {
                return {
                  ...c,
                  links: [...c.links, newLink],
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

    // Preload favicon to ensure we get the best quality from tabs API
    if (linkData.url && !newLink.favIconUrl) {
      preloadFavicon(linkData.url)
        .then((url) => {
          get().updateLink(
            projectId,
            collectionId,
            newLink.id,
            { favIconUrl: url },
            true // isInternalCall
          );
        })
        .catch((error) => {
          console.error('Failed to preload favicon:', error);
        });
    }

    if (!skipBookmarkCreation && collection.bookmarkFolderId) {
      (async () => {
        try {
          const newBookmark = await bookmarkStorage.createLink(
            newLink.title!,
            newLink.url,
            collection.bookmarkFolderId!
          );
          get().updateLink(
            projectId,
            collectionId,
            newLink.id,
            { bookmarkId: newBookmark.id },
            true // isInternalCall
          );
        } catch (error) {
          console.error(
            `Failed to create bookmark for link ${newLink.title}:`,
            error
          );
        }
      })();
    } else if (!skipBookmarkCreation) {
      console.warn(
        `Collection ${collectionId} does not have a bookmarkFolderId. Cannot create link bookmark.`
      );
    }

    // Enqueue a link create for cloud projects. Bookmark id is device-local and
    // omitted; collectionId places the link in the right collection.
    void enqueueCloudChange({
      projectId,
      entityType: 'link',
      entityId: newLink.id,
      operation: 'create',
      patch: {
        collectionId,
        url: newLink.url,
        title: newLink.title ?? null,
        favIconUrl: newLink.favIconUrl ?? null,
        notes: newLink.notes ?? null,
        tags: newLink.tags ?? [],
        order: newLink.order ?? 0,
      },
    });
  },

  updateLink: (
    projectId: string,
    collectionId: string,
    linkId: string,
    updates: Partial<Link>,
    isInternalCall = false
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;
      const collection = project.collections.find(
        (c: Collection) => c.id === collectionId
      );
      if (!collection) return state;
      const linkToUpdate = collection.links.find((l: Link) => l.id === linkId);
      if (!linkToUpdate) return state;

      const oldTitle = linkToUpdate.title;
      const newTitle = updates.title;
      const oldUrl = linkToUpdate.url;
      const newUrl = updates.url;

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === collectionId) {
                return {
                  ...c,
                  links: c.links.map((l: Link) =>
                    l.id === linkId
                      ? { ...l, ...updates, updatedAt: new Date() }
                      : l
                  ),
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

      if (
        !isInternalCall &&
        linkToUpdate.bookmarkId &&
        ((newTitle && newTitle !== oldTitle) || (newUrl && newUrl !== oldUrl))
      ) {
        (async () => {
          try {
            await bookmarkStorage.updateLink(linkToUpdate.bookmarkId!, {
              title: newTitle || oldTitle,
              url: newUrl || oldUrl,
            });
            console.log(`Bookmark for link ${linkId} updated.`);
          } catch (error) {
            console.error(
              `Failed to update bookmark for link ${linkId}:`,
              error
            );
          }
        })();
      }
      return { projects: updatedProjects };
    });

    // Enqueue a link update for cloud projects (skips internal calls like
    // favicon preload or bookmark id backfill).
    if (!isInternalCall) {
      const patch = buildLinkUpdatePatch(updates);
      if (patch) {
        void enqueueCloudChange({
          projectId,
          entityType: 'link',
          entityId: linkId,
          operation: 'update',
          patch,
        });
      }
    }
  },

  deleteLink: (projectId: string, collectionId: string, linkId: string) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;
      const collection = project.collections.find(
        (c: Collection) => c.id === collectionId
      );
      if (!collection) return state;
      const linkToDelete = collection.links.find((l: Link) => l.id === linkId);

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === collectionId) {
                return {
                  ...c,
                  links: c.links.filter((l: Link) => l.id !== linkId),
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

      if (linkToDelete && linkToDelete.bookmarkId) {
        (async () => {
          try {
            await bookmarkStorage.deleteLink(linkToDelete.bookmarkId!);
            console.log(`Bookmark for link ${linkId} deleted.`);
          } catch (error) {
            console.error(
              `Failed to delete bookmark for link ${linkId}:`,
              error
            );
          }
        })();
      }
      return { projects: updatedProjects };
    });

    void enqueueCloudChange({
      projectId,
      entityType: 'link',
      entityId: linkId,
      operation: 'delete',
      patch: {},
    });
  },
});
