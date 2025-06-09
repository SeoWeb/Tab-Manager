import { nanoid } from 'nanoid';
import type { Project } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { bookmarkSyncService } from '@/lib/bookmarkSyncService';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createProjectActions = (set: any, get: () => AppState) => ({
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
            const newBookmarkFolder = await bookmarkStorage.createProject(
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
            await bookmarkStorage.updateProject(
              projectToUpdate.bookmarkFolderId!,
              newName
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
            await bookmarkStorage.deleteProject(
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
