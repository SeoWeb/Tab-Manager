import { useAppStore } from '@/stores/appStore';
import { getApiBaseUrl, getClientId } from './config';
import { getToken } from './authStorage';
import { CloudSyncApiError, requestRealtimeTicket } from './client';
import {
  realtimeUrl,
  handleRealtimeMessage,
  resetRealtimeChunkBuffer,
} from './realtimeMessages';

// Re-export the pure helpers so callers can import everything from one module.
export {
  realtimeUrl,
  handleRealtimeMessage,
  resetRealtimeChunkBuffer,
} from './realtimeMessages';
export type { RealtimeStoreLike } from './realtimeMessages';

/**
 * Phase 5 realtime client.
 *
 * Opens a WebSocket to the project's Durable Object so edits made by other
 * members appear instantly instead of waiting for the next poll. Message
 * handling (apply changes, advance cursor, presence) lives in the pure
 * `realtimeMessages` module; this module owns the socket lifecycle.
 *
 * Auth (harden-auth-tokens): browsers cannot set headers on `new WebSocket`
 * and query params leak, so the access token is exchanged (via
 * `POST /realtime/ticket`, Bearer-authenticated) for a short-lived single-use
 * ticket that is presented during the handshake as a `Sec-WebSocket-Protocol`
 * entry (`tabspace-auth`, <ticket>). Tokens and tickets NEVER appear in the
 * URL. A fresh ticket is fetched for every attempt — the server-side TTL is
 * 60 s and tickets are single-use, so nothing is cached across reconnects.
 *
 * The socket lives for the active project and is managed from
 * `CloudSyncRealtime` (popup/newtab); the background service worker does not use
 * realtime.
 */

const MAX_BACKOFF_MS = 30_000;

/** The supported auth subprotocol the server echoes back on success. */
const REALTIME_AUTH_PROTOCOL = 'tabspace-auth';

let socket: WebSocket | null = null;
let activeProjectId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
/**
 * Bumped by every connect/disconnect. In-flight ticket requests compare their
 * generation on resume so a superseded attempt can never open a socket.
 */
let connectGeneration = 0;

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
  const generation = ++connectGeneration;

  const baseUrl = (await getApiBaseUrl()).trim();
  if (!baseUrl) return;
  const token = await getToken();
  if (!token) return;
  const clientId = await getClientId();

  await openSocket(projectId, baseUrl, clientId, generation);
}

async function openSocket(
  projectId: string,
  baseUrl: string,
  clientId: string,
  generation: number
): Promise<void> {
  if (generation !== connectGeneration) return;
  // A fresh (or reconnecting) socket starts with no partial chunk groups — an
  // interrupted group from the previous connection can never complete.
  resetRealtimeChunkBuffer();

  // Fresh single-use ticket per attempt. A 401 here has already been through
  // the client's renew-then-retry path; a hard 401 means the session is
  // unrecoverable and the once-only re-auth signal has fired — stop
  // reconnecting until the user signs in again. Other failures (network,
  // rate limit, 5xx) follow the normal backoff schedule below.
  let ticket: string;
  try {
    ticket = await requestRealtimeTicket(projectId);
  } catch (error) {
    if (generation !== connectGeneration) return;
    if (error instanceof CloudSyncApiError && error.status === 401) {
      return;
    }
    scheduleReconnect(projectId, baseUrl, clientId, generation);
    return;
  }
  if (generation !== connectGeneration) return;

  const url = realtimeUrl(baseUrl, projectId, clientId);
  let ws: WebSocket;
  try {
    ws = new WebSocket(url, [REALTIME_AUTH_PROTOCOL, ticket]);
  } catch {
    scheduleReconnect(projectId, baseUrl, clientId, generation);
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
      scheduleReconnect(projectId, baseUrl, clientId, generation);
    }
  };

  ws.onerror = () => {
    // `onclose` follows an error and handles reconnection.
  };
}

function scheduleReconnect(
  projectId: string,
  baseUrl: string,
  clientId: string,
  generation: number
): void {
  if (reconnectTimer) return;
  attempt += 1;
  const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (activeProjectId === projectId) {
      void openSocket(projectId, baseUrl, clientId, generation);
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
  connectGeneration += 1;
  resetRealtimeChunkBuffer();
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
