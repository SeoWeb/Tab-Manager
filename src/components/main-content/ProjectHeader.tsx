import React from 'react';
import { Project } from '@/types';
import SearchBar from './SearchBar';
import ThemeToggle from './ThemeToggle';
import ProjectActionsMenu from './ProjectActionsMenu';
import { BookmarkSyncStatus } from '@/components/sync/BookmarkSyncStatus';
import { useAppStore } from '@/stores/appStore';
import { highlightText } from '@/lib/highlight';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Filter } from 'lucide-react';

type SortOption = 'name' | 'date';

interface ProjectHeaderProps {
  project: Project;
  onSearch: (query: string) => void;
}

const ProjectHeader = React.forwardRef<HTMLInputElement, ProjectHeaderProps>(
  ({ project, onSearch }, ref) => {
    const {
      searchQuery,
      searchFilters,
      sortOption,
      setSearchFilters,
      setSortOption,
    } = useAppStore((state) => ({
      searchQuery: state.searchQuery,
      searchFilters: state.searchFilters,
      sortOption: state.sortOption,
      setSearchFilters: state.setSearchFilters,
      setSortOption: state.setSortOption,
    }));

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
          {highlightText(project.name, searchQuery)}
        </h1>

        <SearchBar onSearch={onSearch} ref={ref} />

        <div className='flex items-center space-x-3'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                aria-label='Filter and sort search results'
              >
                <Filter className='mr-2 h-4 w-4' />
                Filter & Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>Filter by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={searchFilters.projects}
                onCheckedChange={(checked) =>
                  setSearchFilters({ projects: !!checked })
                }
              >
                Projects
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={searchFilters.collections}
                onCheckedChange={(checked) =>
                  setSearchFilters({ collections: !!checked })
                }
              >
                Collections
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={searchFilters.links}
                onCheckedChange={(checked) =>
                  setSearchFilters({ links: !!checked })
                }
              >
                Links
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortOption}
                onValueChange={(value) => setSortOption(value as SortOption)}
              >
                <DropdownMenuRadioItem value='name'>Name</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='date'>Date</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <BookmarkSyncStatus />
          <ThemeToggle />
          <ProjectActionsMenu project={project} />
        </div>
      </header>
    );
  }
);

ProjectHeader.displayName = 'ProjectHeader';

export default ProjectHeader;
