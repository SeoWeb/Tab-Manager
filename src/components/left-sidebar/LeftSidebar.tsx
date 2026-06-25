'use client';

import ProjectList from './ProjectList';
import AddProjectButton from './AddProjectButton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Settings as SettingsIcon, PanelLeft, CheckSquare } from 'lucide-react';
import { useSetActiveView } from '@/hooks/useAppStoreWithDefaults';
import { useSidebarState } from '@/hooks/useSidebarState';
import { cn } from '@/lib/utils';

export default function LeftSidebar() {
  const setActiveView = useSetActiveView();
  const { open: sidebarOpen, toggleSidebar } = useSidebarState();
  const isCollapsed = !sidebarOpen;

  return (
    <>
      <div
        className={`h-full z-20 transition-all duration-200 ease-linear ${
          isCollapsed ? 'w-[3rem]' : 'w-[16rem]'
        } bg-sidebar border-r border-sidebar-border flex flex-col`}
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
        <div className='flex-grow p-0'>
          <ScrollArea className='h-full scrollbar-modern'>
            <div className={cn(isCollapsed ? 'p-1' : 'p-4')}>
              <ProjectList />
            </div>
          </ScrollArea>
        </div>

        <Separator className='bg-sidebar-border' />

        {/* Footer */}
        <div className={cn('flex flex-col gap-2', isCollapsed ? 'p-1' : 'p-4')}>
          <AddProjectButton />
          <Button
            variant='outline'
            size='sm'
            className='w-full justify-start text-sm'
            onClick={() => setActiveView('tasks')}
            aria-label='Open tasks'
          >
            <CheckSquare
              className={`h-5 w-5 ${isCollapsed ? 'mr-0' : 'mr-2'}`}
            />
            {!isCollapsed && <span>Tasks</span>}
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='w-full justify-start text-sm'
            onClick={() => setActiveView('settings')}
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
