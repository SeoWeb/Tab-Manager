'use client';

import {
  RefreshCw,
  CheckCircle2,
  CloudOff,
  AlertCircle,
  AlertTriangle,
  Cloud,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import type { CloudSyncStatus } from '@/lib/cloudflareSync/types';

interface CloudSyncStatusBadgeProps {
  className?: string;
  /** Hide the text label and show only the icon. */
  iconOnly?: boolean;
}

interface StatusMeta {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon: typeof Cloud;
  className: string;
  spin?: boolean;
}

function statusMeta(status: CloudSyncStatus, pending: number): StatusMeta {
  switch (status) {
    case 'syncing':
      return {
        label: 'Syncing…',
        variant: 'secondary',
        icon: RefreshCw,
        className: 'text-blue-500',
        spin: true,
      };
    case 'synced':
      return {
        label: pending > 0 ? `Synced · ${pending} pending` : 'Synced',
        variant: 'secondary',
        icon: CheckCircle2,
        className: 'text-green-500',
      };
    case 'offline':
      return {
        label: 'Offline',
        variant: 'outline',
        icon: CloudOff,
        className: 'text-muted-foreground',
      };
    case 'error':
      return {
        label: 'Sync failed',
        variant: 'destructive',
        icon: AlertCircle,
        className: '',
      };
    case 'conflict':
      return {
        label: 'Conflict',
        variant: 'destructive',
        icon: AlertTriangle,
        className: '',
      };
    case 'idle':
    default:
      return {
        label: pending > 0 ? `${pending} pending` : 'Cloud idle',
        variant: 'outline',
        icon: Cloud,
        className: 'text-muted-foreground',
      };
  }
}

export function CloudSyncStatusBadge({
  className,
  iconOnly = false,
}: CloudSyncStatusBadgeProps) {
  const cloudSync = useAppStore((state) => state.cloudSync);

  if (!cloudSync.enabled) {
    return (
      <Badge variant='outline' className={cn('gap-1.5', className)}>
        <Cloud className='h-3.5 w-3.5 text-muted-foreground' />
        {!iconOnly && <span className='text-muted-foreground'>Cloud off</span>}
      </Badge>
    );
  }

  const meta = statusMeta(cloudSync.status, cloudSync.pendingMutationCount);
  const Icon = meta.icon;
  const realtimeConnected = cloudSync.realtimeConnected ?? false;

  return (
    <Badge variant={meta.variant} className={cn('gap-1.5', className)}>
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          meta.className,
          meta.spin && 'animate-spin'
        )}
      />
      {!iconOnly && <span>{meta.label}</span>}
      {realtimeConnected && (
        <span
          className='inline-block h-1.5 w-1.5 rounded-full bg-green-500'
          title='Live — realtime connected'
          aria-label='Realtime connected'
        />
      )}
    </Badge>
  );
}
