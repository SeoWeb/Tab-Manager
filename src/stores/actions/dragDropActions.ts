import type { Project, Collection, Link } from '@/types';
import type { AppState } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createDragDropActions = (set: any) => ({
  moveLink: (
    projectId: string,
    sourceCollectionId: string,
    linkId: string,
    targetCollectionId: string
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
                // Add link to target collection
                const newLink = {
                  ...linkToMove,
                  order: c.links.length, // Add to end
                };
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

      const updatedProjects = state.projects.map((p: Project) => {
        if (p.id === projectId) {
          return {
            ...p,
            collections: p.collections.map((c: Collection) => {
              if (c.id === collectionId) {
                const newLinks = [...c.links];
                const [movedLink] = newLinks.splice(activeIndex, 1);
                newLinks.splice(overIndex, 0, movedLink);

                // Update order values
                const reorderedLinks = newLinks.map(
                  (link: Link, index: number) => ({
                    ...link,
                    order: index,
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
  },
});
