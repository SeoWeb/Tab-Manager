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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TasksView from '../views/TasksView';
import TaskCalendarView from '../views/TaskCalendarView';
import NotesView from '../views/NotesView';
import TodosView from '../views/TodosView';

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
    tasks,
    setActiveTask,
  } = useAppStore((state) => ({
    searchQuery: state.searchQuery,
    searchFilters: state.searchFilters,
    sortOption: state.sortOption,
    setSearchQuery: state.setSearchQuery,
    toggleAllCollections: state.toggleAllCollections,
    tasks: state.tasks,
    setActiveTask: state.setActiveTask,
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
            // If collection name matches, show all links in the collection
            // If only links match, show only filtered links
            return {
              ...collection,
              links: collectionNameMatch ? collection.links : filteredLinks,
            };
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
  const originalActiveProject = projects.find((p) => p.id === activeProjectId);

  // If no project is selected at all (not just filtered out)
  if (!originalActiveProject) {
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
        project={originalActiveProject}
        onSearch={handleSearch}
        ref={searchInputRef}
      />
      <div className='flex-1 p-6 overflow-y-auto scrollbar-modern'>
        <Tabs defaultValue='collections'>
          <TabsList>
            <TabsTrigger value='collections'>Collections</TabsTrigger>
            <TabsTrigger value='tasks'>Tasks</TabsTrigger>
            <TabsTrigger value='calendar'>Calendar</TabsTrigger>
            <TabsTrigger value='notes'>Notes</TabsTrigger>
            <TabsTrigger value='todos'>Todos</TabsTrigger>
          </TabsList>
          <TabsContent value='collections'>
            {activeProject ? (
              <DragEnabledCollectionsList project={activeProject} />
            ) : (
              <div className='text-center py-10'>
                <h3 className='text-lg font-medium text-gray-600 dark:text-gray-300 mb-2'>
                  No results found
                </h3>
                <p className='text-gray-500 dark:text-gray-400'>
                  No projects, collections, or links match your search query
                  &quot;
                  {searchQuery}&quot;.
                </p>
                <p className='text-sm text-gray-400 dark:text-gray-500 mt-2'>
                  Try adjusting your search terms or clear the search to see all
                  content.
                </p>
              </div>
            )}
          </TabsContent>
          <TabsContent value='tasks'>
            <TasksView />
          </TabsContent>
          <TabsContent value='calendar'>
            <TaskCalendarView
              tasks={tasks}
              onViewTask={(task) => setActiveTask(task.id)}
            />
          </TabsContent>
          <TabsContent value='notes'>
            <NotesView />
          </TabsContent>
          <TabsContent value='todos'>
            <TodosView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default MainContentArea;
