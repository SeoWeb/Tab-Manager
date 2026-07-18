import type { Collection, Link, Project } from '@/types';
import type { AppState } from '../../types';
import type { StoreApi } from 'zustand';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';

export const createCollectionHelpers = (
  set: StoreApi<AppState>['setState'],
  get: () => AppState
) => ({
  openCollectionInNewWindow: (projectId: string, collectionId: string) => {
    const project = get().projects.find((p: Project) => p.id === projectId);
    if (!project) return;

    const collection = project.collections.find(
      (c: Collection) => c.id === collectionId
    );
    if (!collection || collection.links.length === 0) return;

    const urls = collection.links.map((link: Link) => link.url);
    // In the extension, open all URLs in a new Chrome window. In the web build
    // (no `chrome.windows`), open each in a new browser tab. Behavior-neutral
    // for the extension: the guard takes the chrome branch exactly as before.
    if (typeof chrome !== 'undefined' && chrome.windows?.create) {
      chrome.windows.create({ url: urls });
    } else {
      urls.forEach((url) => window.open(url, '_blank', 'noopener'));
    }
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

    // Push each collection's new minimized state to the cloud.
    const project = get().projects.find((p) => p.id === projectId);
    if (project) {
      for (const collection of project.collections) {
        void enqueueCloudChange({
          projectId,
          entityType: 'collection',
          entityId: collection.id,
          operation: 'update',
          patch: { minimized: collection.minimized ?? false },
        });
      }
    }
  },

  setCollectionName: (
    projectId: string,
    collectionId: string,
    name: string
  ) => {
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
    }));

    void enqueueCloudChange({
      projectId,
      entityType: 'collection',
      entityId: collectionId,
      operation: 'update',
      patch: { name },
    });
  },

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
