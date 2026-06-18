import type { CloudPresenceUser, CloudSyncChange } from './types';

/**
 * Pure realtime message handling (Phase 5), kept separate from the WebSocket
 * client so it has no dependency on the Zustand store singleton and can be unit
 * tested in isolation.
 */

/** The minimal store surface `handleRealtimeMessage` touches (for testability). */
export interface RealtimeStoreLike {
  mergeRemoteChanges: (changes: CloudSyncChange[], clientId: string) => void;
  setProjectCursor: (projectId: string, cursor: number) => void;
  setOnlinePresence: (users: CloudPresenceUser[]) => void;
  cloudSync?: { cursors?: Record<string, number> };
}

/** Build the WebSocket URL from the configured HTTP Worker base. */
export function realtimeUrl(
  httpBase: string,
  projectId: string,
  token: string,
  clientId: string
): string {
  const base = httpBase.replace(/\/+$/, '');
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const params = new URLSearchParams({ token, clientId });
  return `${wsBase}/projects/${encodeURIComponent(projectId)}/realtime?${params.toString()}`;
}

/**
 * Apply one realtime frame to the store. Returns whether it was a recognized,
 * acted-on message. Pure with respect to the injected store.
 */
export function handleRealtimeMessage(
  data: unknown,
  deps: { clientId: string; store: RealtimeStoreLike }
): boolean {
  let message: unknown;
  if (typeof data === 'string') {
    try {
      message = JSON.parse(data);
    } catch {
      return false;
    }
  } else {
    message = data;
  }
  if (typeof message !== 'object' || message === null) return false;

  const msg = message as { type?: unknown; changes?: unknown; users?: unknown };

  if (msg.type === 'changes' && Array.isArray(msg.changes)) {
    const changes = msg.changes as CloudSyncChange[];
    deps.store.mergeRemoteChanges(changes, deps.clientId);

    // Advance each affected project's cursor to the highest change id seen, but
    // never backward. This keeps the next pull/alarm sync from re-fetching rows
    // we already applied live.
    const existing = deps.store.cloudSync?.cursors ?? {};
    const maxByProject = new Map<string, number>();
    for (const change of changes) {
      const cur = maxByProject.get(change.project_id) ?? 0;
      if (change.id > cur) maxByProject.set(change.project_id, change.id);
    }
    for (const [projectId, id] of maxByProject) {
      if (id > (existing[projectId] ?? 0)) {
        deps.store.setProjectCursor(projectId, id);
      }
    }
    return true;
  }

  if (msg.type === 'presence' && Array.isArray(msg.users)) {
    deps.store.setOnlinePresence(msg.users as CloudPresenceUser[]);
    return true;
  }

  // 'hello' / 'pong' / unknown -> ignored.
  return false;
}
