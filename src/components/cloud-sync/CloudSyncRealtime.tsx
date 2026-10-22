'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  connectProjectRealtime,
  disconnectProjectRealtime,
} from '@/lib/cloudflareSync/realtime';
import { syncAllCloudProjects } from '@/lib/cloudflareSync/orchestrator';

/**
 * Phase 5 realtime + connectivity glue for the popup/newtab.
 *
 *  - Opens a realtime WebSocket for the active cloud project (tearing it down on
 *    switch / disable / unmount) so cloud-cursor updates and remote changes land
 *    in the store as they happen.
 *  - On the browser `online` event, runs a full sync and reconnects the socket
 *    (the service worker has no `window`, so the online trigger lives here).
 *
 * Cross-context state propagation is NOT this component's job anymore: the
 * storage layer (`src/stores/storage.ts` + the appStore onChanged subscription)
 * rehydrates through the merge path whenever another context persists. Its old
 * storage-watching wholesale rehydrate path was removed — see
 * fix-cross-context-data-loss §1.5.
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
