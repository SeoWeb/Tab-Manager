'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  connectProjectRealtime,
  disconnectProjectRealtime,
} from '@/lib/cloudflareSync/realtime';
import { syncAllCloudProjects } from '@/lib/cloudflareSync/orchestrator';

const STORE_KEY = 'tab-manager-storage';

/**
 * Phase 5 realtime + background-coordination glue for the popup/newtab.
 *
 *  - Opens a realtime WebSocket for the active cloud project (tearing it down on
 *    switch / disable / unmount).
 *  - On the browser `online` event, runs a full sync and reconnects the socket
 *    (the service worker has no `window`, so the online trigger lives here).
 *  - When the background service worker writes a newer sync to storage, rehydrates
 *    the local store so the UI reflects changes pulled while it was open.
 *
 * Renders nothing.
 */
export function CloudSyncRealtime() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const enabled = useAppStore((s) => s.cloudSync.enabled);
  const projectCloudEnabled = useAppStore((s) => {
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    return project?.cloudEnabled ?? false;
  });

  // Track the last synced-at / reconciled-at we observed so we only rehydrate on
  // a change, and guard against the rehydrate-write-back loop. Reconcile writes
  // `lastReconciledAt` (not `lastSyncedAt`), so we must watch both — otherwise
  // collections the background worker pulled in never reach the open tab.
  const lastSeenSyncedAt = useRef<string | null | undefined>(undefined);
  const lastSeenReconciledAt = useRef<string | null | undefined>(undefined);
  const isRehydrating = useRef(false);

  // (Re)connect the realtime socket for the active cloud project.
  useEffect(() => {
    if (!enabled || !projectCloudEnabled || !activeProjectId) {
      disconnectProjectRealtime();
      return;
    }
    void connectProjectRealtime(activeProjectId);
    return () => {
      disconnectProjectRealtime();
    };
  }, [enabled, projectCloudEnabled, activeProjectId]);

  // Seed the observed synced-at / reconciled-at so the first external change
  // isn't a false hit.
  useEffect(() => {
    const cloudSync = useAppStore.getState().cloudSync;
    lastSeenSyncedAt.current = cloudSync.lastSyncedAt;
    lastSeenReconciledAt.current = cloudSync.lastReconciledAt;
  }, []);

  // Pick up changes the background service worker applied to storage while the
  // popup was open. Zustand rehydrate only reads storage into memory, but it
  // writes back (persist setItem) — the isRehydrating guard breaks that loop.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

    const handler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return;
      const change = changes[STORE_KEY];
      if (!change || typeof change.newValue !== 'string') return;

      let incomingSyncedAt: string | null = null;
      let incomingReconciledAt: string | null = null;
      try {
        const parsed = JSON.parse(change.newValue) as {
          state?: {
            cloudSync?: {
              lastSyncedAt?: string | null;
              lastReconciledAt?: string | null;
            };
          };
        };
        incomingSyncedAt = parsed.state?.cloudSync?.lastSyncedAt ?? null;
        incomingReconciledAt =
          parsed.state?.cloudSync?.lastReconciledAt ?? null;
      } catch {
        return;
      }
      if (
        incomingSyncedAt === lastSeenSyncedAt.current &&
        incomingReconciledAt === lastSeenReconciledAt.current
      ) {
        return;
      }
      lastSeenSyncedAt.current = incomingSyncedAt;
      lastSeenReconciledAt.current = incomingReconciledAt;
      if (isRehydrating.current) return;

      isRehydrating.current = true;
      Promise.resolve(useAppStore.persist.rehydrate())
        .catch(() => undefined)
        .finally(() => {
          isRehydrating.current = false;
        });
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  // Sync on (re)connectivity and reconnect the realtime socket.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      void syncAllCloudProjects();
      if (enabled && projectCloudEnabled && activeProjectId) {
        void connectProjectRealtime(activeProjectId);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [enabled, projectCloudEnabled, activeProjectId]);

  return null;
}
