'use client';

import ProjectList from './ProjectList';
import AddProjectButton from './AddProjectButton';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  Settings as SettingsIcon,
  PanelLeft,
  CheckSquare,
  FolderOpen,
} from 'lucide-react';
import {
  useSetActiveView,
  useAppStoreWithDefaults,
} from '@/hooks/useAppStoreWithDefaults';
import { useSidebarState } from '@/hooks/useSidebarState';
import { cn } from '@/lib/utils';

export default function LeftSidebar() {
  const setActiveView = useSetActiveView();
  const activeView = useAppStoreWithDefaults(
    (state) => state.activeView,
    'projectDetail'
  );
  const { open: sidebarOpen, setOpen, toggleSidebar } = useSidebarState();
  const isCollapsed = !sidebarOpen;

  const handleNavigate = (view: typeof activeView) => {
    setActiveView(view);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setOpen(false);
    }
  };

  return (
    <>
      {/* Backdrop overlay for mobile screens when sidebar is open */}
      {!isCollapsed && (
        <div
          className='fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-200'
          onClick={toggleSidebar}
        />
      )}

      <div
        className={cn(
          'h-full bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out z-50 md:z-20',
          // Mobile floating overlay drawer vs Desktop relative sidebar
          'fixed inset-y-0 left-0 w-[16rem] md:relative md:translate-x-0',
          isCollapsed
            ? '-translate-x-full md:w-[3rem]'
            : 'translate-x-0 md:w-[16rem]'
        )}
      >
        {/* Header */}
        <div className='p-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center'>
              {sidebarOpen && (
                <h1 className='text-2xl font-semibold font-headline text-sidebar-foreground'>
                  TabSpace
                </h1>
              )}
            </div>
            <Button
              variant='ghost'
              size='icon'
              onClick={toggleSidebar}
              className='h-7 w-7'
              aria-label='Collapse sidebar'
            >
              <PanelLeft className='h-4 w-4' />
            </Button>
          </div>
        </div>

        <Separator className='bg-sidebar-border' />

        {/* Content */}
        <div className='flex-grow min-h-0 p-0'>
          <ProjectList />
        </div>

        <Separator className='bg-sidebar-border' />

        {/* Footer */}
        <div className={cn('flex flex-col gap-2', isCollapsed ? 'p-1' : 'p-4')}>
          <AddProjectButton />
          <Button
            variant={activeView === 'projectDetail' ? 'secondary' : 'outline'}
            size='sm'
            className={cn(
              'w-full justify-start text-sm',
              activeView === 'projectDetail' &&
                'bg-primary/10 text-primary hover:bg-primary/20'
            )}
            onClick={() => handleNavigate('projectDetail')}
            aria-label='Open collections'
          >
            <FolderOpen
              className={`h-5 w-5 ${isCollapsed ? 'mr-0' : 'mr-2'}`}
            />
            {!isCollapsed && <span>Collections</span>}
          </Button>
          <Button
            variant={activeView === 'tasks' ? 'secondary' : 'outline'}
            size='sm'
            className={cn(
              'w-full justify-start text-sm',
              activeView === 'tasks' &&
                'bg-primary/10 text-primary hover:bg-primary/20'
            )}
            onClick={() => handleNavigate('tasks')}
            aria-label='Open tasks'
          >
            <CheckSquare
              className={`h-5 w-5 ${isCollapsed ? 'mr-0' : 'mr-2'}`}
            />
            {!isCollapsed && <span>Tasks</span>}
          </Button>
          <Button
            variant={activeView === 'settings' ? 'secondary' : 'outline'}
            size='sm'
            className={cn(
              'w-full justify-start text-sm',
              activeView === 'settings' &&
                'bg-primary/10 text-primary hover:bg-primary/20'
            )}
            onClick={() => handleNavigate('settings')}
            aria-label='Open settings'
          >
            <SettingsIcon
              className={`h-5 w-5 ${isCollapsed ? 'mr-0' : 'mr-2'}`}
            />
            {!isCollapsed && <span>Settings</span>}
          </Button>
        </div>
      </div>
    </>
  );
}
