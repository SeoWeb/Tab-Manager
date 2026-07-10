'use client';

import { GitMerge, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import type { SyncConflictItem } from '@/lib/cloudflareSync/types';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '“”';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ConflictRow({ conflict }: { conflict: SyncConflictItem }) {
  const resolveSyncConflict = useAppStore((s) => s.resolveSyncConflict);
  const dismissSyncConflict = useAppStore((s) => s.dismissSyncConflict);
  const isText =
    typeof conflict.localValue === 'string' &&
    typeof conflict.remoteValue === 'string';

  return (
    <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-950/30'>
      <div className='mb-2 flex items-start justify-between gap-2'>
        <div className='font-medium capitalize'>
          {conflict.entityType} · {conflict.field}
        </div>
        <button
          type='button'
          aria-label='Dismiss conflict'
          className='text-muted-foreground hover:text-foreground'
          onClick={() => dismissSyncConflict(conflict.id)}
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <div className='grid grid-cols-2 gap-2 text-xs'>
        <div className='rounded bg-background/60 p-2'>
          <div className='mb-1 font-medium text-muted-foreground'>
            Your edit
          </div>
          <div className='whitespace-pre-wrap break-words'>
            {formatValue(conflict.localValue)}
          </div>
        </div>
        <div className='rounded bg-background/60 p-2'>
          <div className='mb-1 font-medium text-muted-foreground'>
            Their edit
          </div>
          <div className='whitespace-pre-wrap break-words'>
            {formatValue(conflict.remoteValue)}
          </div>
        </div>
      </div>

      <div className='mt-2 flex flex-wrap gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() => resolveSyncConflict(conflict.id, 'local')}
        >
          Keep mine
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => resolveSyncConflict(conflict.id, 'remote')}
        >
          Take theirs
        </Button>
        {isText && (
          <Button
            size='sm'
            onClick={() => resolveSyncConflict(conflict.id, 'merge')}
          >
            <GitMerge className='mr-1.5 h-3.5 w-3.5' />
            Merge
          </Button>
        )}
      </div>
    </div>
  );
}

export function SyncConflictsPanel() {
  const conflicts = useAppStore((s) => s.syncConflicts);

  if (!conflicts.length) return null;

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400'>
        <AlertTriangle className='h-4 w-4' />
        {conflicts.length} sync conflict{conflicts.length === 1 ? '' : 's'} need
        your decision
      </div>
      {conflicts.map((conflict) => (
        <ConflictRow key={conflict.id} conflict={conflict} />
      ))}
    </div>
  );
}
