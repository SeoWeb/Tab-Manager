'use client';

import type { Project } from '@/types';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { SidebarTrigger } from '@/components/ui/sidebar'; // Import SidebarTrigger

interface ProjectHeaderProps {
  project: Project;
}

export default function ProjectHeader({ project }: ProjectHeaderProps) {
  const { toggleDarkMode, isDarkMode } = useAppStore();
  // Removed toggleRightPanel, isRightPanelOpen as they are replaced by new vertical tab logic

  return (
    <header className='p-4 border-b border-border bg-card flex items-center justify-between shrink-0'>
      <div className='flex items-center gap-2'>
        <SidebarTrigger className='md:hidden' />{' '}
        {/* Hidden on md and larger screens */}
        <h2 className='text-xl font-semibold font-headline text-card-foreground'>
          {project.name}
        </h2>
      </div>
      <div className='flex items-center gap-2'>
        <Button
          variant='ghost'
          size='icon'
          onClick={toggleDarkMode}
          aria-label={
            isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'
          }
        >
          {isDarkMode ? (
            <Sun className='h-5 w-5' />
          ) : (
            <Moon className='h-5 w-5' />
          )}
        </Button>
        {/* The button to toggle the right panel is now part of VerticalRightTabsBar */}
      </div>
    </header>
  );
}
