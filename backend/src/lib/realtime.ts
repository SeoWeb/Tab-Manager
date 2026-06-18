import type { Env, Role, SyncChange } from '../types';

/**
 * Phase 5 realtime presence + change fan-out.
 *
 * One `ProjectRoom` Durable Object backs each project (keyed by project id via
 * `idForName`). Members connect over a WebSocket; when the sync handler commits
 * new change-log rows it pokes the DO, which fans them out to every connected
 * socket so other members see edits without waiting for the next pull.
 *
 * The DO uses the WebSocket Hibernation API: idle sockets hibernate (free) and
 * wake on the next message/event. Per-connection identity (user / display name /
 * role / client id) is carried as hibernation tags so presence can be rebuilt
 * faithfully even after a wake, without keeping an in-memory session map.
 */

/** A connected member, as broadcast to clients for presence display. */
export interface PresenceUser {
  userId: string;
  displayName: string;
  role: Role;
}

/** Identity decoded from a single socket's hibernation tags. */
interface PresenceInfo {
  userId: string;
  displayName: string;
  role: Role;
  clientId: string;
}

const TAG_PREFIXES = {
  user: 'user:',
  name: 'name:',
  role: 'role:',
  client: 'client:',
} as const;

/**
 * Build the hibernation tags for a connecting socket. `displayName` is URL-
 * encoded because tags are opaque strings and display names can contain colons,
 * commas, or other awkward characters.
 */
export function buildPresenceTags(info: PresenceInfo): string[] {
  return [
    `${TAG_PREFIXES.user}${info.userId}`,
    `${TAG_PREFIXES.name}${encodeURIComponent(info.displayName)}`,
    `${TAG_PREFIXES.role}${info.role}`,
    `${TAG_PREFIXES.client}${info.clientId}`,
  ];
}

/** Decode a single socket's identity from its hibernation tags. */
export function parsePresenceFromTags(tags: string[]): PresenceInfo | null {
  if (!Array.isArray(tags)) return null;
  let userId = '';
  let displayName = '';
  let role: Role = 'viewer';
  let clientId = '';
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (tag.startsWith(TAG_PREFIXES.user)) {
      userId = tag.slice(TAG_PREFIXES.user.length);
    } else if (tag.startsWith(TAG_PREFIXES.name)) {
      displayName = decodeURIComponent(tag.slice(TAG_PREFIXES.name.length));
    } else if (tag.startsWith(TAG_PREFIXES.role)) {
      role = tag.slice(TAG_PREFIXES.role.length) as Role;
    } else if (tag.startsWith(TAG_PREFIXES.client)) {
      clientId = tag.slice(TAG_PREFIXES.client.length);
    }
  }
  if (!userId) return null;
  return { userId, displayName, role, clientId };
}

/**
 * Build the presence roster from a list of per-socket tag arrays. Duplicate
 * users (a member connected from two devices) collapse to one entry, keeping
 * the display stable regardless of how many sockets a user holds.
 */
export function presenceSnapshot(allTags: string[][]): PresenceUser[] {
  const byId = new Map<string, PresenceUser>();
  for (const tags of allTags) {
    const info = parsePresenceFromTags(tags);
    if (!info) continue;
    if (!byId.has(info.userId)) {
      byId.set(info.userId, {
        userId: info.userId,
        displayName: info.displayName,
        role: info.role,
      });
    }
  }
  return [...byId.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decode a header value, tolerating un-encoded input (no-op on failure). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class ProjectRoom implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly _env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal fan-out endpoint, called by the sync/CRUD handlers after they
    // commit change-log rows. `ctx.waitUntil` isn't needed here — the caller
    // awaits this subrequest, but it is cheap (co-located DO).
    if (url.pathname.endsWith('/notify')) {
      return this.handleNotify(request);
    }

    // WebSocket upgrade. Browsers can't attach headers to `new WebSocket(...)`,
    // so the Worker route has already authenticated the token and stamped the
    // user identity onto request headers before forwarding here.
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    return this.handleUpgrade(request);
  }

  private handleUpgrade(request: Request): Response {
    // The Worker route URL-encodes the display name header (it may hold
    // non-ASCII or header-unfriendly characters); decode it back here.
    const rawName = request.headers.get('X-User-Name') ?? '';
    const info: PresenceInfo = {
      userId: request.headers.get('X-User-Id') ?? 'unknown',
      displayName: safeDecode(rawName),
      role: (request.headers.get('X-User-Role') as Role) ?? 'viewer',
      clientId: request.headers.get('X-Client-Id') ?? '',
    };

    const pair = new WebSocketPair();
    const socket = pair[1];
    // Tags persist across hibernation, so identity survives an idle wake.
    this.ctx.acceptWebSocket(socket, buildPresenceTags(info));

    socket.send(JSON.stringify({ type: 'hello' }));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async handleNotify(request: Request): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    const changes = isRecord(payload) && Array.isArray(payload.changes)
      ? (payload.changes as unknown[])
      : [];
    if (changes.length === 0) {
      return new Response(null, { status: 204 });
    }

    const message = JSON.stringify({ type: 'changes', changes });
    this.broadcast(message);
    return new Response(null, { status: 204 });
  }

  /** Hibernation handler: keep-alive ping/pong. */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    let parsed: unknown;
    try {
      parsed =
        typeof message === 'string'
          ? JSON.parse(message)
          : JSON.parse(new TextDecoder().decode(message));
    } catch {
      return; // ignore malformed client frames
    }
    if (isRecord(parsed) && parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  /** Hibernation handler: a member left — refresh presence for the rest. */
  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.broadcastPresence();
  }

  /** Hibernation handler: close on error so presence recomputes. */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, 'WebSocket error');
  }

  private broadcastPresence(): void {
    const users = presenceSnapshot(this.allSocketTags());
    this.broadcast(JSON.stringify({ type: 'presence', users }));
  }

  /** Send a string to every connected (possibly hibernating) socket. */
  private broadcast(message: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // A socket may be mid-close; skip it.
      }
    }
  }

  private allSocketTags(): string[][] {
    return this.ctx.getWebSockets().map((ws) => this.ctx.getTags(ws));
  }
}

/**
 * Push newly-applied change-log rows to every member currently viewing a
 * project. Best-effort: a realtime failure must never fail the originating sync
 * or CRUD request, so all errors are swallowed. A no-op when there is nothing to
 * broadcast or the DO binding is absent (e.g. older deploy / unit test).
 */
export async function notifyRealtime(
  env: Env,
  projectId: string,
  changes: SyncChange[]
): Promise<void> {
  if (!changes.length) return;
  if (!env.PROJECT_ROOM) return;
  try {
    const id = env.PROJECT_ROOM.idFromName(projectId);
    const stub = env.PROJECT_ROOM.get(id);
    await stub.fetch(
      new Request('https://project-room.local/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
    );
  } catch (error) {
    console.error('[realtime] notify failed', error);
  }
}
