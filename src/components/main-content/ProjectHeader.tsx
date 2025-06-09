import React from 'react';
import { Project } from '@/types';
import SearchBar from './SearchBar';
import ThemeToggle from './ThemeToggle';
import ProjectActionsMenu from './ProjectActionsMenu';
import { BookmarkSyncStatus } from '@/components/sync/BookmarkSyncStatus';

interface ProjectHeaderProps {
  project: Project;
  onSearch: (query: string) => void;
}

const ProjectHeader: React.FC<ProjectHeaderProps> = ({ project, onSearch }) => {
  if (!project) {
    return (
      <header className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
        <h1 className='text-2xl font-semibold text-gray-500 dark:text-gray-400'>
          No project selected
        </h1>
        <div className='flex items-center space-x-3'></div>
      </header>
    );
  }

  return (
    <header className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
      <h1
        className='text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate'
        title={project.name}
      >
        {project.name}
      </h1>

      <SearchBar onSearch={onSearch} />

      <div className='flex items-center space-x-3'>
        <BookmarkSyncStatus />
        <ThemeToggle />
        <ProjectActionsMenu project={project} />
      </div>
    </header>
  );
};

export default ProjectHeader;
