import { nanoid } from 'nanoid';
import type { Project } from '@/types';
import type { AppState } from '../types';
import { bookmarkStorage } from '@/lib/bookmarkStorage';
import { bookmarkSyncService } from '@/lib/bookmarkSyncService';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createProjectActions = (set: any, get: () => AppState) => ({
  addProject: (
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>,
    options?: {
      skipBookmarkCreation?: boolean;
      id?: string;
      cloudEnabled?: boolean;
      cloudRole?: Project['cloudRole'];
    }
  ) => {
    const skipBookmarkCreation = options?.skipBookmarkCreation ?? false;
    const newProject: Project = {
      id: options?.id ?? generateId(),
      name: projectData.name,
      description: projectData.description || '',
      color: projectData.color || '#CCCCCC',
      icon: projectData.icon || '',
      collections: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      order: get().projects.length,
      bookmarkFolderId: null, // Initialize with null
      cloudEnabled: options?.cloudEnabled ?? false,
      cloudRole: options?.cloudRole,
    };

    set((state: AppState) => ({
      projects: [...state.projects, newProject],
    }));

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

    // Enqueue a project update mutation for cloud projects. Internal calls
    // (e.g. bookmarkFolderId backfill) are skipped, and only cloud-relevant
    // fields are sent — bookmarkFolderId is device-local.
    if (!isInternalCall) {
      const patch = buildProjectUpdatePatch(updates);
      if (patch) {
        void enqueueCloudChange({
          projectId: id,
          entityType: 'project',
          entityId: id,
          operation: 'update',
          patch,
        });
      }
    }
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
        // Cascade-delete the project's notes/tasks locally. The backend
        // already cascades these via ON DELETE CASCADE on project_id.
        notes: state.notes.filter((note) => note.projectId !== id),
        tasks: state.tasks.filter((task) => task.projectId !== id),
      };
    });

    // Tell the server to soft-delete the project too. enqueueCloudChange is a
    // no-op for local-only projects.
    void enqueueCloudChange({
      projectId: id,
      entityType: 'project',
      entityId: id,
      operation: 'delete',
      patch: {},
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

/**
 * Build the cloud patch for a project update from the local `updates` object,
 * keeping only fields the Worker stores (name/description/color/icon). Returns
 * null when there is nothing cloud-relevant to sync (e.g. a bookmarkFolderId-only
 * internal update).
 */
function buildProjectUpdatePatch(
  updates: Partial<Project>
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.description !== undefined)
    patch.description = updates.description;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.icon !== undefined) patch.icon = updates.icon;
  return Object.keys(patch).length > 0 ? patch : null;
}
