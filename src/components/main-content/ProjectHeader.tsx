import React, { useState, useEffect } from 'react';
import { Project } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsIcon, SunIcon, MoonIcon, SearchIcon } from 'lucide-react';
import EditProjectModal from '@/components/modals/EditProjectModal'; // Import EditProjectModal

interface ProjectHeaderProps {
  project: Project;
  onSearch: (query: string) => void;
}

const ProjectHeader: React.FC<ProjectHeaderProps> = ({ project, onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    onSearch(searchQuery);
  }, [searchQuery, onSearch]);
  // --- Placeholder Theme Logic (Retained from previous step) ---
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const storedTheme = localStorage.getItem('app-theme') as 'light' | 'dark';
    if (storedTheme) {
      setCurrentTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(currentTheme === 'light' ? 'dark' : 'light');
    root.classList.add(currentTheme);
    localStorage.setItem('app-theme', currentTheme);
  }, [currentTheme]);

  const handleThemeToggle = () => {
    setCurrentTheme(currentTheme === 'light' ? 'dark' : 'light');
  };
  // --- End Placeholder Theme Logic ---

  // State for EditProjectModal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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

  const handleEditProjectTrigger = () => {
    setIsEditModalOpen(true);
  };

  const handleDeleteProjectTrigger = () => {
    // This will also open the EditProjectModal, where the user can then click the delete button.
    setIsEditModalOpen(true);
  };

  return (
    <>
      {' '}
      {/* Use Fragment to allow modal to be a sibling */}
      <header className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
        <h1
          className='text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate'
          title={project.name}
        >
          {project.name}
        </h1>
        <div className='flex-1 max-w-md px-4'>
          <div className='relative'>
            <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400' />
            <Input
              type='search'
              placeholder='Search collections and links...'
              className='pl-10 w-full'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className='flex items-center space-x-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleThemeToggle}
            aria-label={`Switch to ${
              currentTheme === 'light' ? 'dark' : 'light'
            } mode`}
          >
            {currentTheme === 'light' ? (
              <MoonIcon className='h-5 w-5' />
            ) : (
              <SunIcon className='h-5 w-5' />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' aria-label='Project settings'>
                <SettingsIcon className='h-5 w-5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>Project Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleEditProjectTrigger}>
                Edit Project
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDeleteProjectTrigger}
                className='text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-700/20 dark:focus:text-red-500'
              >
                Delete Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {/* Edit Project Modal Instance */}
      <EditProjectModal
        project={project}
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      >
        <></>
      </EditProjectModal>
    </>
  );
};

export default ProjectHeader;
