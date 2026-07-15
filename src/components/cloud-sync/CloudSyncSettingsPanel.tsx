'use client';

import { useState } from 'react';
import {
  Cloud,
  RefreshCw,
  LogOut,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { CloudSyncStatusBadge } from './CloudSyncStatusBadge';
import { SyncConflictsPanel } from './SyncConflictsPanel';
import { CloudSyncLoginForm } from './CloudSyncLoginForm';
import {
  disconnectCloudAccount,
  syncAllCloudProjects,
} from '@/lib/cloudflareSync/orchestrator';

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'Never';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function CloudSyncSettingsPanel() {
  const cloudSync = useAppStore((state) => state.cloudSync);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isConnected = !!cloudSync.account;
  const isSyncing = cloudSync.status === 'syncing';

  const handleDisconnect = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await disconnectCloudAccount();
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await syncAllCloudProjects();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <Cloud className='h-5 w-5 text-muted-foreground' />
            <div>
              <CardTitle className='text-base'>Cloud Sync</CardTitle>
            </div>
          </div>
          <CloudSyncStatusBadge />
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* Status / account */}
        {isConnected ? (
          <div className='space-y-3'>
            <SyncConflictsPanel />
            <div className='rounded-md border p-3 text-sm'>
              <div className='flex items-center gap-2'>
                <CheckCircle2 className='h-4 w-4 text-green-500' />
                <span className='font-medium'>
                  Signed in as {cloudSync.account?.email}
                </span>
              </div>
              <dl className='mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground'>
                <dt>Last synced</dt>
                <dd className='text-right'>
                  {formatLastSynced(cloudSync.lastSyncedAt)}
                </dd>
                <dt>Pending changes</dt>
                <dd className='text-right'>{cloudSync.pendingMutationCount}</dd>
                {cloudSync.account?.displayName && (
                  <>
                    <dt>Name</dt>
                    <dd className='text-right'>
                      {cloudSync.account.displayName}
                    </dd>
                  </>
                )}
              </dl>
              {cloudSync.lastError && (
                <p className='mt-2 flex items-center gap-1.5 text-xs text-destructive'>
                  <AlertCircle className='h-3.5 w-3.5' />
                  {cloudSync.lastError}
                </p>
              )}
            </div>

            <div className='flex flex-wrap gap-2'>
              <Button onClick={handleSyncNow} disabled={busy || isSyncing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {isSyncing ? 'Syncing…' : 'Sync now'}
              </Button>
              <Button
                variant='outline'
                onClick={handleDisconnect}
                disabled={busy}
              >
                <LogOut className='mr-2 h-4 w-4' />
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <CloudSyncLoginForm compact />
        )}

        {formError && (
          <p className='flex items-center gap-1.5 text-sm text-destructive'>
            <AlertCircle className='h-4 w-4' />
            {formError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
