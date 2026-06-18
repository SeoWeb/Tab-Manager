'use client';

import { useEffect } from 'react';
import { initCloudSync } from '@/lib/cloudflareSync/orchestrator';

/**
 * Initializes cloud sync state on mount: loads persisted account, API URL, and
 * pending queue length into the store, and resets any transient status left over
 * from a previous session. Renders nothing.
 */
export function CloudSyncProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  // initCloudSync only updates global Zustand state, so there is nothing to
  // guard against on unmount — a late store update after unmount is harmless.
  useEffect(() => {
    void initCloudSync();
  }, []);

  return <>{children}</>;
}
