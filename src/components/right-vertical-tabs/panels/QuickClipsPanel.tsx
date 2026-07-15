'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getQuickClips,
  removeQuickClip,
  subscribeQuickClips,
  type QuickClip,
} from '@/lib/quickClips';
import { DraggableQuickClip } from '@/components/drag-drop/DraggableQuickClip';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import Image from 'next/image';

export default function QuickClipsPanel() {
  const [clips, setClips] = useState<QuickClip[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeQuickClips(setClips);
    return unsubscribe;
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setClips(await getQuickClips());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleOpen = useCallback((url: string) => {
    window.open(url, '_blank');
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    await removeQuickClip(id);
    // The subscription will update the list; refresh defensively.
    setClips(await getQuickClips());
  }, []);

  if (clips.length === 0) {
    return (
      <div className='text-center py-10'>
        <Image
          src='https://placehold.co/200x150.png?text=No+Clips'
          alt='No quick clips'
          className='mx-auto mb-4 rounded-md'
          data-ai-hint='empty state illustration'
          width={200}
          height={150}
        />
        <p className='text-muted-foreground'>No quick clips yet.</p>
        <p className='text-xs text-muted-foreground mt-2'>
          Right-click a page or link and choose &quot;Save to TabSpace&quot;.
        </p>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col'>
      {/* Header */}
      <div className='flex items-center justify-between px-1 pt-1 pb-2 border-b border-border shrink-0'>
        <h2 className='text-xl font-semibold text-foreground'>Quick Clips</h2>
        <Button
          variant='ghost'
          size='icon'
          onClick={handleRefresh}
          disabled={isRefreshing}
          className='h-8 w-8'
          title='Refresh clips'
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
      </div>

      {/* Scrollable Content */}
      <div className='flex-1 overflow-y-auto px-1'>
        <div className='space-y-2 py-4'>
          {clips.map((clip) => (
            <DraggableQuickClip
              key={clip.id}
              clip={clip}
              onOpen={handleOpen}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className='px-1 pt-2 shrink-0'>
        <p className='text-xs text-muted-foreground text-center'>
          Drag a clip onto a collection to file it. It&apos;s removed from here
          on a successful drop.
        </p>
      </div>
    </div>
  );
}
