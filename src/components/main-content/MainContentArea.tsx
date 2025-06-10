import React, { useCallback, useRef } from 'react';
import {
  useProjects,
  useActiveProjectId,
} from '@/hooks/useAppStoreWithDefaults';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useAppStore } from '@/stores/appStore';
import ProjectHeader from './ProjectHeader';
import DragEnabledCollectionsList from './DragEnabledCollectionsList';
import { Collection, Project } from '@/types';

const MainContentArea: React.FC = () => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();
  const {
    searchQuery,
    searchFilters,
    sortOption,
    setSearchQuery,
    toggleAllCollections,
  } = useAppStore((state) => ({
    searchQuery: state.searchQuery,
    searchFilters: state.searchFilters,
    sortOption: state.sortOption,
    setSearchQuery: state.setSearchQuery,
    toggleAllCollections: state.toggleAllCollections,
  }));

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
    },
    [setSearchQuery]
  );

  useHotkeys('ctrl+k, cmd+k', () => {
    searchInputRef.current?.focus();
  });

  useHotkeys('ctrl+e, cmd+e', () => {
    if (activeProjectId) {
      const project = projects.find((p) => p.id === activeProjectId);
      if (project) {
        const isAnyCollectionExpanded = project.collections.some(
          (c) => !c.minimized
        );
        toggleAllCollections(activeProjectId, !isAnyCollectionExpanded);
      }
    }
  });

  const filteredProjects = projects
    .map((project) => {
      if (!searchQuery) return project;

      const lowerCaseQuery = searchQuery.toLowerCase();

      const filteredCollections = project.collections
        .map((collection) => {
          const filteredLinks = collection.links.filter(
            (link) =>
              searchFilters.links &&
              ((link.title?.toLowerCase() || '').includes(lowerCaseQuery) ||
                link.url.toLowerCase().includes(lowerCaseQuery))
          );

          const collectionNameMatch =
            searchFilters.collections &&
            collection.name.toLowerCase().includes(lowerCaseQuery);

          if (filteredLinks.length > 0 || collectionNameMatch) {
            return { ...collection, links: filteredLinks };
          }
          return null;
        })
        .filter((c): c is Collection => c !== null);

      if (filteredCollections.length > 0) {
        return { ...project, collections: filteredCollections };
      }

      const projectNameMatch =
        searchFilters.projects &&
        project.name.toLowerCase().includes(lowerCaseQuery);
      if (projectNameMatch) {
        return { ...project, collections: [] };
      }

      return null;
    })
    .filter((p): p is Project => p !== null)
    .sort((a, b) => {
      if (sortOption === 'name') {
        return a.name.localeCompare(b.name);
      } else if (sortOption === 'date') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      }
      return 0;
    });

  const activeProject = filteredProjects.find((p) => p.id === activeProjectId);

  if (!activeProject) {
    return (
      <div className='flex-1 p-6 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400'>
        <h2 className='text-2xl font-semibold'>No Project Selected</h2>
        <p>Please select a project from the sidebar to view its content.</p>
        {projects.length === 0 && (
          <p className='mt-4'>
            You don&apos;t have any projects yet. Click &quot;Add Project&quot;
            to get started!
          </p>
        )}
      </div>
    );
  }

  return (
    <div className='flex-1 flex flex-col bg-white dark:bg-gray-900 h-full w-full'>
      <ProjectHeader
        project={activeProject}
        onSearch={handleSearch}
        ref={searchInputRef}
      />
      <div className='flex-1 p-6 overflow-y-auto'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-xl font-semibold text-gray-700 dark:text-gray-200'>
            Collections
          </h2>
        </div>
        <DragEnabledCollectionsList project={activeProject} />
      </div>
    </div>
  );
};

export default MainContentArea;
