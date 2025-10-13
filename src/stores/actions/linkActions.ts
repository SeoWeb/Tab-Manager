import { nanoid } from 'nanoid';
import type { Link, Project, Collection } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { preloadFavicon } from '@/lib/utils';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createLinkActions = (set: any, get: () => AppState) => ({
  addLink: (
    projectId: string,
    collectionId: string,
    linkData: Pick<Link, 'title' | 'url' | 'favIconUrl' | 'tags' | 'notes'>,
    skipBookmarkCreation = false
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;
      const collection = project.collections.find(
        (c: Collection) => c.id === collectionId
      );
      if (!collection) return state;

      // Preload favicon to ensure we get the best quality from tabs API
      const faviconUrl = linkData.favIconUrl || '';
      if (linkData.url && !faviconUrl) {
        // Preload favicon asynchronously without blocking link creation
        preloadFavicon(linkData.url)
          .then((url) => {
            // Update the link with the preloaded favicon
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

      const newLink: Link = {
        id: generateId(),
        title: linkData.title || 'Untitled Link',
        url: linkData.url,
        favIconUrl: faviconUrl,
        tags: linkData.tags || [],
        notes: linkData.notes || '',
        createdAt: new Date(),
        order: collection.links.length,
        bookmarkId: null,
      };

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
                    l.id === linkId ? { ...l, ...updates } : l
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
  },
});
