import { nanoid } from 'nanoid';
import type { Project } from '@/types';
import type { AppState } from '../types';
import { bookmarkService } from '@/lib/bookmarkService';
import { bookmarkSyncService } from '@/lib/bookmarkSyncService';
import { TAB_MANAGER_ROOT_FOLDER_NAME } from '../constants';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createProjectActions = (set: any, get: () => AppState) => ({
  initializeTabManagerRootFolder: async () => {
    // Prevent multiple simultaneous initializations
    const state = get();
    if (state.tabManagerRootFolderId && state._hasHydrated) {
      console.log('Tab Manager already initialized, skipping...');
      return;
    }

    let currentRootId = state.tabManagerRootFolderId;

    // Check if existing ID is valid
    if (currentRootId) {
      const existingFolder =
        await bookmarkService.getBookmarkNode(currentRootId);
      if (
        existingFolder &&
        existingFolder.title === TAB_MANAGER_ROOT_FOLDER_NAME &&
        !existingFolder.url
      ) {
        // Check it's a folder
        console.log(
          'Tab Manager root folder already exists and ID is valid:',
          currentRootId
        );
        // Initialize bookmark sync service
        await bookmarkSyncService.initialize();
        // Perform initial sync
        await bookmarkSyncService.performFullSync();
        return;
      }
      console.log(
        'Previous Tab Manager root folder ID is invalid or folder mismatch. Re-searching/creating.'
      );
      currentRootId = null;
    }

    const parentIdForRoot = '2'; // "Other Bookmarks"
    try {
      const childrenOfOtherBookmarks =
        await bookmarkService.getChildren(parentIdForRoot);
      const foundFolder = childrenOfOtherBookmarks.find(
        (node) => node.title === TAB_MANAGER_ROOT_FOLDER_NAME && !node.url
      );

      if (foundFolder) {
        console.log('Found existing Tab Manager root folder:', foundFolder.id);
        // Update the store with the found folder ID
        set((state: AppState) => ({
          ...state,
          tabManagerRootFolderId: foundFolder.id,
        }));
        // Initialize bookmark sync service
        await bookmarkSyncService.initialize();
        // Perform initial sync
        await bookmarkSyncService.performFullSync();
      } else {
        console.log(
          `"${TAB_MANAGER_ROOT_FOLDER_NAME}" folder not found, creating under "Other Bookmarks"...`
        );
        const newFolder = await bookmarkService.createBookmarkFolder(
          TAB_MANAGER_ROOT_FOLDER_NAME,
          parentIdForRoot
        );
        console.log('Created Tab Manager root folder:', newFolder.id);
        // Update the store with the new folder ID
        set((state: AppState) => ({
          ...state,
          tabManagerRootFolderId: newFolder.id,
        }));
        // Initialize bookmark sync service
        await bookmarkSyncService.initialize();
      }
    } catch (error) {
      console.error('Error initializing Tab Manager root folder:', error);
    }
  },

  addProject: (
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>
  ) => {
    set((state: AppState) => {
      const newProject: Project = {
        id: generateId(),
        name: projectData.name,
        description: projectData.description || '',
        color: projectData.color || '#CCCCCC',
        icon: projectData.icon || '',
        collections: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        bookmarkFolderId: null, // Initialize with null
      };

      // Asynchronous part for bookmark creation
      (async () => {
        const rootFolderId = get().tabManagerRootFolderId;
        if (rootFolderId) {
          try {
            const newBookmarkFolder =
              await bookmarkService.createBookmarkFolder(
                newProject.name,
                rootFolderId
              );
            // Update the project in the store with the bookmarkFolderId
            get().updateProject(
              newProject.id,
              { bookmarkFolderId: newBookmarkFolder.id },
              true
            );
          } catch (error) {
            console.error(
              `Failed to create bookmark folder for project ${newProject.name}:`,
              error
            );
          }
        } else {
          console.warn(
            'Tab Manager root bookmark folder ID not found. Cannot create project bookmark folder.'
          );
        }
      })();

      return { projects: [...state.projects, newProject] };
    });
  },

  updateProject: (
    id: string,
    updates: Partial<Project>,
    isInternalCall = false
  ) => {
    set((state: AppState) => {
      const projectToUpdate = state.projects.find((p: Project) => p.id === id);
      if (!projectToUpdate) return state; // Should not happen if ID is correct

      const oldName = projectToUpdate.name;
      const newName = updates.name;

      const updatedProjects = state.projects.map((p: Project) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
      );

      // Asynchronous part for bookmark update
      if (
        !isInternalCall &&
        newName &&
        newName !== oldName &&
        projectToUpdate.bookmarkFolderId
      ) {
        (async () => {
          try {
            await bookmarkService.updateBookmark(
              projectToUpdate.bookmarkFolderId!,
              { title: newName }
            );
            console.log(
              `Bookmark folder for project ${id} renamed to ${newName}`
            );
          } catch (error) {
            console.error(
              `Failed to update bookmark folder name for project ${id}:`,
              error
            );
          }
        })();
      }
      return { projects: updatedProjects };
    });
  },

  deleteProject: (id: string) => {
    set((state: AppState) => {
      const projectToDelete = state.projects.find((p: Project) => p.id === id);
      const updatedProjects = state.projects.filter(
        (p: Project) => p.id !== id
      );
      let newActiveProjectId = state.activeProjectId;

      if (state.activeProjectId === id) {
        newActiveProjectId =
          updatedProjects.length > 0 ? updatedProjects[0].id : null;
      }

      // Asynchronous part for bookmark deletion
      if (projectToDelete && projectToDelete.bookmarkFolderId) {
        (async () => {
          try {
            await bookmarkService.deleteBookmarkTree(
              projectToDelete.bookmarkFolderId!
            );
            console.log(`Bookmark folder for project ${id} deleted.`);
          } catch (error) {
            console.error(
              `Failed to delete bookmark folder for project ${id}:`,
              error
            );
          }
        })();
      }
      return {
        projects: updatedProjects,
        activeProjectId: newActiveProjectId,
      };
    });
  },

  syncBookmarks: async () => {
    try {
      console.log('Manual bookmark sync triggered');
      await bookmarkSyncService.performFullSync();
    } catch (error) {
      console.error('Manual bookmark sync failed:', error);
    }
  },
});
