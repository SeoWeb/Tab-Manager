import { useAppStore } from '@/stores/appStore';
import { getApiBaseUrl, getClientId } from './config';
import { getToken } from './authStorage';
import { realtimeUrl, handleRealtimeMessage } from './realtimeMessages';

// Re-export the pure helpers so callers can import everything from one module.
export { realtimeUrl, handleRealtimeMessage } from './realtimeMessages';
export type { RealtimeStoreLike } from './realtimeMessages';

/**
 * Phase 5 realtime client.
 *
 * Opens a WebSocket to the project's Durable Object so edits made by other
 * members appear instantly instead of waiting for the next poll. Message
 * handling (apply changes, advance cursor, presence) lives in the pure
 * `realtimeMessages` module; this module owns the socket lifecycle.
 *
 * Auth: the Worker expects the JWT as a `?token=` query param (browsers cannot
 * set headers on `new WebSocket(...)`). The connection is only made over the
 * configured Worker URL, and WSS encrypts the token in transit.
 *
 * The socket lives for the active project and is managed from
 * `CloudSyncRealtime` (popup/newtab); the background service worker does not use
 * realtime.
 */

const MAX_BACKOFF_MS = 30_000;

let socket: WebSocket | null = null;
let activeProjectId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

/** Whether the realtime socket is currently open. */
export function isRealtimeConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

/**
 * Open (or keep open) the realtime socket for `projectId`. No-op if already
 * connected/connecting to that project. Connecting to a different project tears
 * the previous socket down first.
 */
export async function connectProjectRealtime(projectId: string): Promise<void> {
  if (
    activeProjectId === projectId &&
    (socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  disconnectProjectRealtime();
  activeProjectId = projectId;

  const baseUrl = (await getApiBaseUrl()).trim();
  if (!baseUrl) return;
  const token = await getToken();
  if (!token) return;
  const clientId = await getClientId();

  openSocket(projectId, baseUrl, token, clientId);
}

function openSocket(
  projectId: string,
  baseUrl: string,
  token: string,
  clientId: string
): void {
  const url = realtimeUrl(baseUrl, projectId, token, clientId);
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect(projectId, baseUrl, token, clientId);
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    useAppStore.getState().setRealtimeConnected(true);
  };

  ws.onmessage = (event: MessageEvent) => {
    handleRealtimeMessage(event.data, {
      clientId,
      store: useAppStore.getState(),
    });
  };

  ws.onclose = () => {
    if (socket === ws) {
      socket = null;
      useAppStore.getState().setRealtimeConnected(false);
    }
    // Only auto-reconnect if we still want this project (not a deliberate close).
    if (activeProjectId === projectId) {
      scheduleReconnect(projectId, baseUrl, token, clientId);
    }
  };

  ws.onerror = () => {
    // `onclose` follows an error and handles reconnection.
  };
}

function scheduleReconnect(
  projectId: string,
  baseUrl: string,
  token: string,
  clientId: string
): void {
  if (reconnectTimer) return;
  attempt += 1;
  const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (activeProjectId === projectId) {
      openSocket(projectId, baseUrl, token, clientId);
    }
  }, delay);
}

/**
 * Tell collaborators which entity + field we are currently editing, so they can
 * see (and avoid clobbering) our in-progress work via a soft lock. Pass
 * `field: null` (or omit) to clear when the field loses focus.
 */
export function sendEditingPresence(
  entityId: string,
  field: string | null
): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(
      JSON.stringify({
        type: 'editing',
        entityId,
        field: field ?? null,
      })
    );
  } catch {
    // socket may be mid-close; ignore
  }
}

/** Close the realtime socket and stop auto-reconnecting. */
export function disconnectProjectRealtime(): void {
  activeProjectId = null;
  attempt = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    const previous = socket;
    socket = null;
    try {
      previous.close();
    } catch {
      // ignore — socket may already be closing
    }
  }
  useAppStore.getState().setRealtimeConnected(false);
}
