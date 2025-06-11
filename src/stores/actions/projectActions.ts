import { nanoid } from 'nanoid';
import type { Project } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { bookmarkSyncService } from '@/lib/bookmarkSyncService';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createProjectActions = (set: any, get: () => AppState) => ({
  addProject: (
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>,
    skipBookmarkCreation = false
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
        order: state.projects.length,
        bookmarkFolderId: null, // Initialize with null
      };

      // Asynchronous part for bookmark creation
      if (!skipBookmarkCreation) {
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
      }

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

  moveProject: (projectId: string, direction: 'up' | 'down') => {
    set((state: AppState) => {
      const projectIndex = state.projects.findIndex(
        (p: Project) => p.id === projectId
      );
      if (projectIndex === -1) return state;

      // Check bounds for movement
      if (direction === 'up' && projectIndex === 0) return state;
      if (direction === 'down' && projectIndex === state.projects.length - 1)
        return state;

      const newProjects = [...state.projects];
      const [movedProject] = newProjects.splice(projectIndex, 1);

      let newIndex: number;
      if (direction === 'up') {
        newIndex = Math.max(0, projectIndex - 1);
      } else {
        newIndex = Math.min(newProjects.length, projectIndex + 1);
      }

      newProjects.splice(newIndex, 0, movedProject);

      // Update order values for all projects
      const reorderedProjects = newProjects.map(
        (project: Project, index: number) => ({
          ...project,
          order: index,
          updatedAt: new Date(),
        })
      );

      return { projects: reorderedProjects };
    });
  },

  reorderProjects: (activeId: string, overId: string) => {
    set((state: AppState) => {
      const oldIndex = state.projects.findIndex(
        (p: Project) => p.id === activeId
      );
      const newIndex = state.projects.findIndex(
        (p: Project) => p.id === overId
      );

      if (oldIndex === -1 || newIndex === -1) return state;

      const newProjects = [...state.projects];
      const [movedProject] = newProjects.splice(oldIndex, 1);
      newProjects.splice(newIndex, 0, movedProject);

      // Update order values for all projects
      const reorderedProjects = newProjects.map(
        (project: Project, index: number) => ({
          ...project,
          order: index,
          updatedAt: new Date(),
        })
      );

      return { projects: reorderedProjects };
    });
  },

  // Migration function to ensure all projects have order values
  migrateProjectOrder: () => {
    set((state: AppState) => {
      // Check if any projects are missing order values
      const needsMigration = state.projects.some(
        (p: Project) => p.order === undefined || p.order === null
      );

      if (!needsMigration) return state;

      const updatedProjects = state.projects.map(
        (p: Project, index: number) => ({
          ...p,
          order: p.order !== undefined && p.order !== null ? p.order : index,
          updatedAt: new Date(),
        })
      );

      return { projects: updatedProjects };
    });
  },
});
