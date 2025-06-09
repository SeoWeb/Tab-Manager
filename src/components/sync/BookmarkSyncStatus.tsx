// src/components/sync/BookmarkSyncStatus.tsx

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RefreshCw, CheckCircle, AlertCircle, Bookmark } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

interface BookmarkSyncStatusProps {
  className?: string;
}

export function BookmarkSyncStatus({ className }: BookmarkSyncStatusProps) {
  const [isSync, setIsSync] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncBookmarks = useAppStore((state) => state.syncBookmarks);

  const handleManualSync = async () => {
    if (isSync) return;

    setIsSync(true);
    setSyncError(null);

    try {
      await syncBookmarks();
      setLastSyncTime(new Date());
      console.log('Manual bookmark sync completed successfully');
    } catch (error) {
      console.error('Manual bookmark sync failed:', error);
      setSyncError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setIsSync(false);
    }
  };

  const getSyncStatusIcon = () => {
    if (isSync) {
      return <RefreshCw className='h-4 w-4 animate-spin' />;
    }
    if (syncError) {
      return <AlertCircle className='h-4 w-4 text-destructive' />;
    }
    if (lastSyncTime) {
      return <CheckCircle className='h-4 w-4 text-green-500' />;
    }
    return <Bookmark className='h-4 w-4' />;
  };

  const getSyncStatusText = () => {
    if (isSync) {
      return 'Syncing bookmarks...';
    }
    if (syncError) {
      return `Sync error: ${syncError}`;
    }
    if (lastSyncTime) {
      const timeAgo = Math.floor((Date.now() - lastSyncTime.getTime()) / 1000);
      if (timeAgo < 60) {
        return `Synced ${timeAgo}s ago`;
      } else if (timeAgo < 3600) {
        return `Synced ${Math.floor(timeAgo / 60)}m ago`;
      } else {
        return `Synced ${Math.floor(timeAgo / 3600)}h ago`;
      }
    }
    return 'Click to sync bookmarks';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleManualSync}
            disabled={isSync}
            className={cn(
              'h-8 w-8 p-0 hover:bg-secondary/80',
              syncError && 'hover:bg-destructive/10',
              className
            )}
          >
            {getSyncStatusIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-xs'>
          <div className='text-center'>
            <p className='font-medium'>Bookmark Sync</p>
            <p className='text-xs text-muted-foreground mt-1'>
              {getSyncStatusText()}
            </p>
            {!isSync && (
              <p className='text-xs text-muted-foreground mt-1'>
                Keeps your bookmarks and collections in sync
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
