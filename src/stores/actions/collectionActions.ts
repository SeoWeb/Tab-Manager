import { nanoid } from 'nanoid';
import type { Collection, Project, Link } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createCollectionActions = (set: any, get: () => AppState) => ({
  addCollection: (
    projectId: string,
    collectionData: Pick<Collection, 'name' | 'description' | 'color'>,
    skipBookmarkCreation = false
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) {
        console.error(
          `Project with ID ${projectId} not found for adding collection.`
        );
        return state;
      }

      const newCollection: Collection = {
        id: generateId(),
        name: collectionData.name,
        description: collectionData.description || '',
        color: collectionData.color,
        links: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        minimized: false,
        order: project.collections.length,
        bookmarkFolderId: null,
      };

      if (!skipBookmarkCreation && project.bookmarkFolderId) {
        (async () => {
          try {
            const newBookmarkFolder = await bookmarkStorage.createCollection(
              newCollection.name,
              project.bookmarkFolderId!
            );
            get().updateCollection(
              projectId,
              newCollection.id,
              { bookmarkFolderId: newBookmarkFolder.id },
              true // isInternalCall
            );
          } catch (error) {
            console.error(
              `Failed to create bookmark folder for collection ${newCollection.name}:`,
              error
            );
          }
        })();
      } else if (!skipBookmarkCreation) {
        console.warn(
          `Project ${projectId} does not have a bookmarkFolderId. Cannot create collection bookmark folder.`
        );
      }

      const updatedProjects = state.projects.map((p: Project) =>
        p.id === projectId
          ? {
              ...p,
              collections: [...p.collections, newCollection],
              updatedAt: new Date(),
            }
          : p
      );
      return { projects: updatedProjects };
    });
  },

  updateCollection: (
    projectId: string,
    collectionId: string,
    updates: Partial<Collection>,
    isInternalCall = false
  ) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;
      const collectionToUpdate = project.collections.find(
        (c: Collection) => c.id === collectionId
      );
      if (!collectionToUpdate) return state;

      const oldName = collectionToUpdate.name;
      const newName = updates.name;

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) =>
              c.id === collectionId
                ? { ...c, ...updates, updatedAt: new Date() }
                : c
            ),
            updatedAt: new Date(),
          };
        }
        return p;
      });

      if (
        !isInternalCall &&
        newName &&
        newName !== oldName &&
        collectionToUpdate.bookmarkFolderId
      ) {
        (async () => {
          try {
            await bookmarkStorage.updateCollection(
              collectionToUpdate.bookmarkFolderId!,
              newName
            );
            console.log(
              `Bookmark folder for collection ${collectionId} renamed to ${newName}`
            );
          } catch (error) {
            console.error(
              `Failed to update bookmark folder name for collection ${collectionId}:`,
              error
            );
          }
        })();
      }
      return { projects: updatedProjects };
    });
  },

  deleteCollection: (projectId: string, collectionId: string) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;
      const collectionToDelete = project.collections.find(
        (c: Collection) => c.id === collectionId
      );

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.filter(
              (c: Collection) => c.id !== collectionId
            ),
            updatedAt: new Date(),
          };
        }
        return p;
      });

      if (collectionToDelete && collectionToDelete.bookmarkFolderId) {
        (async () => {
          try {
            await bookmarkStorage.deleteCollection(
              collectionToDelete.bookmarkFolderId!
            );
            console.log(
              `Bookmark folder for collection ${collectionId} deleted.`
            );
          } catch (error) {
            console.error(
              `Failed to delete bookmark folder for collection ${collectionId}:`,
              error
            );
          }
        })();
      }
      return { projects: updatedProjects };
    });
  },

  moveCollection: (
    projectId: string,
    collectionId: string,
    direction: 'up' | 'down'
  ) => {
    set((state: AppState) => {
      const projectIndex = state.projects.findIndex(
        (p: Project) => p.id === projectId
      );
      if (projectIndex === -1) return state;

      const project = state.projects[projectIndex];
      const collectionIndex = project.collections.findIndex(
        (c: Collection) => c.id === collectionId
      );
      if (collectionIndex === -1) return state;

      // Check bounds for movement
      if (direction === 'up' && collectionIndex === 0) return state;
      if (
        direction === 'down' &&
        collectionIndex === project.collections.length - 1
      )
        return state;

      const newCollections = [...project.collections];
      const [movedCollection] = newCollections.splice(collectionIndex, 1);

      let newIndex: number;
      if (direction === 'up') {
        newIndex = Math.max(0, collectionIndex - 1);
      } else {
        newIndex = Math.min(newCollections.length, collectionIndex + 1);
      }

      newCollections.splice(newIndex, 0, movedCollection);

      // Update order values for all collections
      const reorderedCollections = newCollections.map(
        (collection: Collection, index: number) => ({
          ...collection,
          order: index,
          updatedAt: new Date(),
        })
      );

      const updatedProjects = [...state.projects];
      updatedProjects[projectIndex] = {
        ...project,
        collections: reorderedCollections,
        updatedAt: new Date(),
      };

      return { projects: updatedProjects };
    });
  },

  openCollectionInNewWindow: (projectId: string, collectionId: string) => {
    const project = get().projects.find((p: Project) => p.id === projectId);
    if (!project) return;

    const collection = project.collections.find(
      (c: Collection) => c.id === collectionId
    );
    if (!collection || collection.links.length === 0) return;

    const urls = collection.links.map((link: Link) => link.url);
    chrome.windows.create({ url: urls });
  },

  toggleAllCollections: (projectId: string, isExpanded: boolean) => {
    set((state: AppState) => {
      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => ({
              ...c,
              minimized: !isExpanded,
            })),
          };
        }
        return p;
      });
      return { projects: updatedProjects };
    });
  },

  setCollectionName: (projectId: string, collectionId: string, name: string) =>
    set((state: AppState) => ({
      projects: state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c) =>
              c.id === collectionId ? { ...c, name, updatedAt: new Date() } : c
            ),
            updatedAt: new Date(),
          };
        }
        return p;
      }),
    })),

  // Migration function to ensure all collections have order values
  migrateCollectionOrder: (projectId: string) => {
    set((state: AppState) => {
      const project = state.projects.find((p: Project) => p.id === projectId);
      if (!project) return state;

      // Check if any collections are missing order values
      const needsMigration = project.collections.some(
        (c: Collection) => c.order === undefined || c.order === null
      );

      if (!needsMigration) return state;

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection, index: number) => ({
              ...c,
              order:
                c.order !== undefined && c.order !== null ? c.order : index,
            })),
            updatedAt: new Date(),
          };
        }
        return p;
      });

      return { projects: updatedProjects };
    });
  },
});
