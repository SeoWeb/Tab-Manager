'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, History, UserPlus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CloudSyncChange } from '@/lib/cloudflareSync/types';
import type { Project } from '@/types';
import { fetchProjectActivity } from '@/lib/cloudflareSync/orchestrator';

function ErrorRow({ message }: { message: string }) {
  return (
    <p className='flex items-center gap-1.5 text-sm text-destructive'>
      <History className='h-4 w-4' />
      {message}
    </p>
  );
}

function OperationIcon({
  operation,
}: {
  operation: CloudSyncChange['operation'];
}) {
  const cls = 'h-3.5 w-3.5';
  if (operation === 'create')
    return <UserPlus className={`${cls} text-green-500`} />;
  if (operation === 'delete')
    return <UserMinus className={`${cls} text-destructive`} />;
  return <History className={`${cls} text-muted-foreground`} />;
}

function describeOperation(op: CloudSyncChange['operation']): string {
  switch (op) {
    case 'create':
      return 'Added';
    case 'update':
      return 'Updated';
    case 'delete':
      return 'Deleted';
    default:
      return 'Changed';
  }
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Human-readable actor label, preferring display name then email. */
function describeActor(change: CloudSyncChange): string {
  const name = change.actor_display_name?.trim();
  if (name) return name;
  if (change.actor_email) return change.actor_email;
  return shortId(change.actor_id);
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function ActivityTab({
  project,
  isActive,
}: {
  project: Project;
  isActive: boolean;
}) {
  const [changes, setChanges] = useState<CloudSyncChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChanges(await fetchProjectActivity(project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity.');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void load().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [isActive, load]);

  if (error) return <ErrorRow message={error} />;
  if (loading && changes.length === 0) {
    return (
      <div className='flex items-center justify-center py-6 text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Loading activity…
      </div>
    );
  }
  if (changes.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No activity yet.
      </p>
    );
  }

  return (
    <div className='flex flex-col'>
      <div className='mb-2 flex items-center justify-end'>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 gap-1.5 text-xs'
          onClick={() => void load()}
          disabled={loading}
        >
          <Loader2 className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <ScrollArea className='max-h-[320px]'>
        <ol className='space-y-1'>
          {changes.map((change) => (
            <li
              key={change.id}
              className='flex items-start gap-2 rounded-md px-2 py-1.5 text-sm'
            >
              <span className='mt-0.5'>
                <OperationIcon operation={change.operation} />
              </span>
              <div className='min-w-0 flex-1'>
                <p className='text-foreground'>
                  <span className='font-medium'>
                    {describeOperation(change.operation)}
                  </span>{' '}
                  a {change.entity_type}
                  {change.client_mutation_id ? '' : ' (server-side)'}
                </p>
                <p
                  className='text-xs text-muted-foreground'
                  title={formatAbsolute(change.created_at)}
                >
                  by {describeActor(change)} ·{' '}
                  {formatRelative(change.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  );
}
