'use client';

import { useState } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { useChromeTabsMonitoring } from '@/hooks/useChromeTabsMonitoring';
import type { ChromeWindowInfo } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Edit2,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FolderPlus,
} from 'lucide-react';
import Image from 'next/image';
import { switchToTab, closeTab } from '@/lib/tabService';
import { DraggableTab } from '@/components/drag-drop/DraggableTab';
import { useToast } from '@/hooks/use-toast';

export default function ChromeOpenTabsPanel() {
  const chromeWindows = useAppStoreWithDefaults(
    (state) => state.chromeWindows,
    []
  );
  const renameChromeWindow = useAppStoreWithDefaults(
    (state) => state.renameChromeWindow,
    () => {}
  );
  const addChromeWindowToCollections = useAppStoreWithDefaults(
    (state) => state.addChromeWindowToCollections,
    () => {}
  );
  const activeProjectId = useAppStoreWithDefaults(
    (state) => state.activeProjectId,
    null
  );
  const [editingWindowId, setEditingWindowId] = useState<number | null>(null);
  const [newWindowName, setNewWindowName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [minimizedWindows, setMinimizedWindows] = useState<Set<number>>(
    new Set()
  );

  // Set up Chrome tabs monitoring
  const { refreshTabs } = useChromeTabsMonitoring();
  const { toast } = useToast();

  const handleRenameWindow = (windowId: number) => {
    if (newWindowName.trim()) {
      renameChromeWindow(windowId, newWindowName.trim());
      setEditingWindowId(null);
      setNewWindowName('');
    }
  };

  const startRename = (window: ChromeWindowInfo) => {
    setEditingWindowId(window.id);
    setNewWindowName(window.name);
  };

  const cancelRename = () => {
    setEditingWindowId(null);
    setNewWindowName('');
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshTabs();
    } catch (error) {
      console.error('Error refreshing tabs:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTabClick = async (tabId: number) => {
    try {
      await switchToTab(tabId);
    } catch (error) {
      console.error('Error switching to tab:', error);
    }
  };

  const handleCloseTab = async (tabId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await closeTab(tabId);
    } catch (error) {
      console.error('Error closing tab:', error);
    }
  };

  const handleAddWindowAsCollection = (windowInfo: ChromeWindowInfo) => {
    if (activeProjectId) {
      addChromeWindowToCollections(windowInfo);
      // Show success feedback
      toast({
        title: 'Collection Created',
        description: `Created "${windowInfo.name}" with ${windowInfo.tabs.length} tabs`,
      });
    } else {
      // Handle case where no project is active
      toast({
        title: 'No Project Selected',
        description:
          'Please select or create a project first to add this window as a collection.',
        variant: 'destructive',
      });
    }
  };

  const toggleMinimizeWindow = (windowId: number) => {
    setMinimizedWindows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(windowId)) {
        newSet.delete(windowId);
      } else {
        newSet.add(windowId);
      }
      return newSet;
    });
  };

  if (chromeWindows.length === 0) {
    return (
      <div className='text-center py-10'>
        <Image
          src='https://placehold.co/200x150.png?text=No+Open+Tabs'
          alt='No open tabs'
          className='mx-auto mb-4 rounded-md'
          data-ai-hint='empty state illustration'
          width={200}
          height={150}
        />
        <p className='text-muted-foreground'>
          No open Chrome tabs detected or mocked.
        </p>
        <p className='text-xs text-muted-foreground mt-2'>
          (This feature usually requires a browser extension)
        </p>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col'>
      {/* Header */}
      <div className='flex items-center justify-between px-1 pt-1 pb-2 border-b border-border shrink-0'>
        <h2 className='text-xl font-semibold text-foreground'>
          Open Chrome Tabs
        </h2>
        <Button
          variant='ghost'
          size='icon'
          onClick={handleRefresh}
          disabled={isRefreshing}
          className='h-8 w-8'
          title='Refresh Chrome tabs'
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
      </div>

      {/* Scrollable Content */}
      <div className='flex-1 overflow-y-auto px-1'>
        <div className='space-y-4 py-4'>
          {chromeWindows.map((window) => (
            <Card key={window.id} className='shadow-md'>
              <CardHeader className='flex flex-row items-center justify-between p-3 bg-card-foreground/5 dark:bg-card-foreground/10'>
                {editingWindowId === window.id ? (
                  <div className='flex items-center gap-2 flex-grow'>
                    <Input
                      value={newWindowName}
                      onChange={(e) => setNewWindowName(e.target.value)}
                      className='h-8 text-sm'
                    />
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => handleRenameWindow(window.id)}
                      className='h-8 w-8'
                    >
                      <Check className='h-4 w-4 text-green-500' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={cancelRename}
                      className='h-8 w-8'
                    >
                      <X className='h-4 w-4 text-red-500' />
                    </Button>
                  </div>
                ) : (
                  <CardTitle
                    className='text-base font-medium text-foreground flex-grow truncate mr-2'
                    title={window.name}
                  >
                    {window.name}
                  </CardTitle>
                )}
                <div className='flex items-center gap-1 shrink-0'>
                  {editingWindowId !== window.id && (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => startRename(window)}
                      className='h-7 w-7'
                      aria-label='Rename window'
                    >
                      <Edit2 className='h-4 w-4' />
                    </Button>
                  )}
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={() => handleAddWindowAsCollection(window)}
                    className='h-7 w-7 bg-primary/10 hover:bg-primary/20 border-primary/30 text-primary hover:text-primary'
                    aria-label='Create collection from window tabs'
                    title='Create collection from all tabs in this window'
                    disabled={!activeProjectId}
                  >
                    <FolderPlus className='h-4 w-4' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => toggleMinimizeWindow(window.id)}
                    className='h-7 w-7'
                    aria-label={
                      minimizedWindows.has(window.id)
                        ? 'Maximize window'
                        : 'Minimize window'
                    }
                  >
                    {minimizedWindows.has(window.id) ? (
                      <ChevronDown className='h-4 w-4' />
                    ) : (
                      <ChevronUp className='h-4 w-4' />
                    )}
                  </Button>
                </div>
              </CardHeader>
              {!minimizedWindows.has(window.id) && (
                <CardContent className='p-3 space-y-2 max-h-60 overflow-y-auto'>
                  {window.tabs.filter(Boolean).map((tab) => (
                    <DraggableTab
                      key={tab.id}
                      tab={tab}
                      onTabClick={handleTabClick}
                      onCloseTab={handleCloseTab}
                      activeProjectId={activeProjectId}
                    />
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className='px-1 pt-2 shrink-0'>
        <p className='text-xs text-muted-foreground text-center'>
          Live Chrome tabs. Click to switch, hover for actions. Drag-and-drop to
          collections coming soon.
        </p>
      </div>
    </div>
  );
}
