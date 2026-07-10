import React from 'react';
import { Project } from '@/types';
import SearchBar from './SearchBar';
import ThemeToggle from './ThemeToggle';
import ProjectActionsMenu from './ProjectActionsMenu';
import { BookmarkSyncStatus } from '@/components/sync/BookmarkSyncStatus';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
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
import { Filter, Menu } from 'lucide-react';
import { useSidebarState } from '@/hooks/useSidebarState';

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
    } = useAppStore(
      useShallow((state) => ({
        searchQuery: state.searchQuery,
        searchFilters: state.searchFilters,
        sortOption: state.sortOption,
        setSearchFilters: state.setSearchFilters,
        setSortOption: state.setSortOption,
      }))
    );
    const { toggleSidebar } = useSidebarState();

    if (!project) {
      return (
        <header className='flex items-center justify-between p-4 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='icon'
              onClick={toggleSidebar}
              className='md:hidden h-8 w-8 shrink-0'
              aria-label='Toggle sidebar'
            >
              <Menu className='h-5 w-5' />
            </Button>
            <h1 className='text-xl md:text-2xl font-semibold text-muted-foreground'>
              No project selected
            </h1>
          </div>
          <div className='flex items-center space-x-3'></div>
        </header>
      );
    }

    return (
      <header className='flex flex-col md:flex-row md:items-center justify-between p-4 border-b border-border gap-3 md:gap-4'>
        {/* Row 1 (Mobile & Desktop Header Title & Mobile Quick Actions) */}
        <div className='flex items-center justify-between w-full md:w-auto gap-3'>
          <div className='flex items-center gap-2 min-w-0'>
            <Button
              variant='ghost'
              size='icon'
              onClick={toggleSidebar}
              className='md:hidden h-8 w-8 shrink-0'
              aria-label='Toggle sidebar'
            >
              <Menu className='h-5 w-5' />
            </Button>
            <h1
              className='text-xl md:text-2xl font-semibold text-foreground truncate'
              title={project.name}
            >
              {highlightText(project.name, searchQuery)}
            </h1>
          </div>

          {/* Quick actions for mobile only */}
          <div className='flex items-center gap-1.5 md:hidden'>
            <BookmarkSyncStatus />
            <ThemeToggle />
            <ProjectActionsMenu project={project} />
          </div>
        </div>

        {/* Row 2 (Search and Filter/Sort on mobile, or SearchBar on desktop) */}
        <div className='flex items-center gap-2 w-full md:max-w-md md:flex-1'>
          <div className='flex-grow'>
            <SearchBar onSearch={onSearch} ref={ref} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='icon'
                className='md:hidden h-9 w-9 shrink-0 flex items-center justify-center'
                aria-label='Filter and sort search results'
              >
                <Filter className='h-4 w-4' />
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
        </div>

        {/* Desktop actions only (hidden on mobile) */}
        <div className='hidden md:flex items-center space-x-3'>
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
