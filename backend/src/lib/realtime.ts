import type { Env, Role, SyncChange } from '../types';
import {
  getProjectMember,
  requireMinRole,
  requireProjectAccess,
} from './membership';
import { requireUser } from './login';
import { badRequest, readJson } from './response';

/**
 * Phase 5 realtime presence + change fan-out.
 *
 * One `ProjectRoom` Durable Object backs each project (keyed by project id via
 * `idForName`). Members connect over a WebSocket presenting a single-use auth
 * ticket (harden-auth-tokens) via `Sec-WebSocket-Protocol`; when the sync
 * handler commits new change-log rows it pokes the DO, which fans them out to
 * every connected socket so other members see edits without waiting for the
 * next pull.
 *
 * Connect auth: the ticket (minted by `POST /realtime/ticket`, which enforces
 * membership at mint time) is verified by the DO — HMAC, expiry, project
 * binding, one-time nonce in DO storage — before the socket is accepted. Auth
 * itself is stateless; a single D1 lookup AFTER verification restores the
 * member's display name + role for presence tags (one query per connect,
 * which is rare under the Hibernation API).
 *
 * Revocation: when membership changes (member removed / role changed), the
 * membership handler pokes the same DO with `{ type: 'members-changed' }`; the
 * DO re-reads live membership from D1 and closes sockets whose user no longer
 * has access. Roles resolved this way override the (immutable) hibernation
 * tags, so a downgraded member is treated by their new role for subsequent
 * fan-out without forcing a reconnect.
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
  /** The entity + field this member is currently editing, if any. */
  editing?: { entityId: string; field: string } | null;
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
 * A serialized `changes` notification whose UTF-8 size exceeds this many bytes
 * is split into ordered `changes-chunk` frames instead of being sent as one
 * giant `changes` frame (scale-sync-backend). At or under the threshold the
 * message keeps today's exact frame shape.
 */
export const REALTIME_MAX_MESSAGE_BYTES = 512 * 1024;

/**
 * Size of each `changes-chunk` payload fragment, in UTF-16 code units
 * (~400 KB of ASCII JSON — safely under the frame cap). The client
 * concatenates fragments by `seq` before parsing, so fragment boundaries can
 * fall anywhere, including inside a string literal or a surrogate pair.
 */
export const REALTIME_CHUNK_SIZE = 400_000;

// ---------------------------------------------------------------------------
// Realtime auth tickets (harden-auth-tokens)
//
// The WebSocket handshake carries no access token. The client first exchanges
// its bearer token for a short-lived single-use ticket (`POST /realtime/ticket`,
// which enforces project membership at mint time), then presents the ticket as
// the second `Sec-WebSocket-Protocol` entry. The DO verifies the HMAC, the
// expiry, the project binding, and the one-time nonce in DO storage — all
// before accepting the socket, and without a D1 round-trip on the connect
// path. Tickets are opaque to the client.
// ---------------------------------------------------------------------------

/** The single auth subprotocol this server supports and selects. */
export const REALTIME_AUTH_PROTOCOL = 'tabspace-auth';

/** Realtime ticket lifetime in seconds (short: single connect attempt). */
export const REALTIME_TICKET_TTL_SECONDS = 60;

/** Consumed nonces stay in DO storage this many seconds past ticket expiry,
 * bounding growth while still rejecting every replay of a known ticket. */
const NONCE_PRUNE_SLACK_SECONDS = 300;

/** DO-storage key prefix for consumed ticket nonces. */
const NONCE_STORAGE_PREFIX = 'rt-nonce:';

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return atob(padded);
}

function base64UrlDecodeBytes(input: string): Uint8Array {
  const decoded = base64UrlDecode(input);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

const ticketEncoder = new TextEncoder();

/** HMAC-SHA256 over the payload bytes, as raw bytes (async: WebCrypto). */
async function hmacTicketSecret(
  secret: string,
  payload: string
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ticketEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, ticketEncoder.encode(payload))
  );
}

/** Constant-time byte comparison (HMAC digests are fixed-length anyway). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export interface RealtimeTicketClaims {
  userId: string;
  projectId: string;
  /** Ticket expiry, unix seconds. */
  exp: number;
  /** One-time nonce; the DO's storage marks it consumed on use. */
  nonce: string;
}

/**
 * Mint a realtime ticket for a verified member: `base64url(payload) +
 * "." + base64url(HMAC-SHA256(JWT_SECRET, payload))` with payload
 * `rt:{userId}:{projectId}:{exp}:{nonce}`. Bound to one project, one user, and
 * a 60 s window; single-use via the DO nonce store. Opaque to the client.
 */
export async function mintRealtimeTicket(
  env: Env,
  userId: string,
  projectId: string
): Promise<{ ticket: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + REALTIME_TICKET_TTL_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `rt:${userId}:${projectId}:${exp}:${nonce}`;
  const signature = await hmacTicketSecret(env.JWT_SECRET, payload);
  const ticket = `${base64UrlEncode(payload)}.${base64UrlEncode(
    String.fromCharCode(...signature)
  )}`;
  return { ticket, expiresAt: exp };
}

/**
 * Verify a realtime ticket against the room's project id: HMAC, `rt:` payload
 * shape, expiry, and project binding. Returns the claims (userId needed for
 * presence identity, nonce for the single-use store) or `null`.
 */
export async function verifyRealtimeTicket(
  env: Env,
  ticket: string,
  projectId: string
): Promise<RealtimeTicketClaims | null> {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let payload: string;
  let signature: Uint8Array;
  try {
    payload = base64UrlDecode(parts[0]);
    signature = base64UrlDecodeBytes(parts[1]);
  } catch {
    return null;
  }
  if (!payload.startsWith('rt:')) return null;

  const expected = await hmacTicketSecret(env.JWT_SECRET, payload);
  if (!timingSafeEqual(signature, expected)) return null;

  const fields = payload.slice('rt:'.length).split(':');
  if (fields.length !== 4) return null;
  const [userId, ticketProjectId, expPart, nonce] = fields;
  const exp = Number.parseInt(expPart, 10);
  if (!userId || !ticketProjectId || !nonce || !Number.isFinite(exp)) {
    return null;
  }
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  if (ticketProjectId !== projectId) return null;
  return { userId, projectId: ticketProjectId, exp, nonce };
}

/**
 * Parse the client's `Sec-WebSocket-Protocol` header. The handshake must
 * present exactly two entries: the supported protocol and the ticket —
 * `tabspace-auth, <ticket>`. Returns the ticket, or `null` for any other
 * shape (missing header, wrong protocol, extra entries, empty ticket).
 */
export function parseRealtimeAuthProtocols(
  header: string | null
): string | null {
  if (!header) return null;
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length !== 2) return null;
  if (entries[0] !== REALTIME_AUTH_PROTOCOL) return null;
  return entries[1];
}

/**
 * `POST /realtime/ticket` — exchange the caller's bearer token for a
 * short-lived single-use realtime ticket for one project.
 *
 * Membership (viewer+) is enforced HERE, in the worker, where a D1 round-trip
 * is cheap — the ticket is an authorization grant, so the check belongs at
 * mint time. The DO then trusts the ticket on connect (≤60 s window) and never
 * touches D1 for the upgrade. Rate limiting classifies this route in the
 * authenticated per-user tier (it carries a Bearer token).
 */
export async function createRealtimeTicket(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).projectId !== 'string' ||
    ((parsed as Record<string, unknown>).projectId as string).length === 0
  ) {
    return badRequest('Invalid request', { projectId: 'projectId is required' });
  }
  const projectId = (parsed as Record<string, unknown>).projectId as string;

  const access = await requireProjectAccess(env, user.id, projectId, 'viewer');
  if (access instanceof Response) return access;

  const { ticket, expiresAt } = await mintRealtimeTicket(
    env,
    user.id,
    projectId
  );
  return Response.json({ ticket, expiresAt });
}

/**
 * Split a serialized notification into fixed-size string fragments. Purely
 * textual: fragments are opaque slices that only make sense concatenated.
 */
export function chunkNotification(message: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < message.length; offset += REALTIME_CHUNK_SIZE) {
    chunks.push(message.slice(offset, offset + REALTIME_CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [message];
}

function serializedByteLength(message: string): number {
  return new TextEncoder().encode(message).byteLength;
}

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
 *
 * `roleOverrides` carries live membership roles (refreshed by the
 * `members-changed` handler) and takes precedence over the connect-time role
 * baked into a socket's tags, so presence reflects the current role.
 */
export function presenceSnapshot(
  allTags: string[][],
  editingByUser: Record<string, { entityId: string; field: string } | null> = {},
  roleOverrides: Record<string, Role> = {}
): PresenceUser[] {
  const byId = new Map<string, PresenceUser>();
  for (const tags of allTags) {
    const info = parsePresenceFromTags(tags);
    if (!info) continue;
    if (!byId.has(info.userId)) {
      const editing = editingByUser[info.userId] ?? undefined;
      byId.set(info.userId, {
        userId: info.userId,
        displayName: info.displayName,
        role: roleOverrides[info.userId] ?? info.role,
        ...(editing ? { editing } : {}),
      });
    }
  }
  return [...byId.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_ROLES: readonly string[] = ['viewer', 'editor', 'admin', 'owner'];

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && VALID_ROLES.includes(value);
}

/**
 * Read the project's live membership (userId -> role) from D1. Used by the
 * `members-changed` handler so socket decisions reflect the database, not the
 * connect-time role stamped into hibernation tags.
 */
async function fetchProjectRoles(
  env: Env,
  projectId: string
): Promise<Map<string, Role>> {
  const rows = await env.D1_DATABASE.prepare(
    'SELECT user_id, role FROM project_members WHERE project_id = ?'
  )
    .bind(projectId)
    .all<{ user_id: string; role: Role }>();

  const roles = new Map<string, Role>();
  for (const row of rows.results ?? []) {
    roles.set(row.user_id, row.role);
  }
  return roles;
}

export class ProjectRoom implements DurableObject {
  /** userId -> the entity+field they are currently editing (ephemeral). */
  private editingByUser = new Map<
    string,
    { entityId: string; field: string }
  >();

  /**
   * userId -> live role, refreshed from D1 whenever `members-changed` arrives.
   * Hibernation tags are immutable once accepted, so refreshed roles live here
   * and take precedence over the (possibly stale) role tag.
   */
  private roleOverrides = new Map<string, Role>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal fan-out endpoint, called by the sync/CRUD handlers after they
    // commit change-log rows. `ctx.waitUntil` isn't needed here — the caller
    // awaits this subrequest, but it is cheap (co-located DO).
    if (url.pathname.endsWith('/notify')) {
      return this.handleNotify(request);
    }

    // WebSocket upgrade. The client presents a single-use realtime ticket as
    // the second `Sec-WebSocket-Protocol` entry (`tabspace-auth, <ticket>`),
    // fetched fresh from `POST /realtime/ticket`. This DO verifies it — HMAC,
    // expiry, project binding, one-time nonce — before accepting the socket;
    // the ticket remains the only auth (no token ever travels by URL). One
    // D1 lookup after verification restores presence name/role.
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    return this.handleUpgrade(request);
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The room is keyed by project id (idFromName), so the path's project must
    // match the ticket's binding — a p1 ticket can never open the p2 room.
    const projectId = url.pathname.split('/').filter(Boolean)[1] ?? '';

    const ticket = parseRealtimeAuthProtocols(
      request.headers.get('Sec-WebSocket-Protocol')
    );
    if (!ticket) {
      return new Response(
        `Expected the ${REALTIME_AUTH_PROTOCOL} auth subprotocol with a ticket`,
        { status: 401 }
      );
    }

    const claims = await verifyRealtimeTicket(this.env, ticket, projectId);
    if (!claims) {
      return new Response('Invalid or expired realtime ticket', {
        status: 401,
      });
    }

    // Single-use enforcement BEFORE the socket is accepted, so a replayed
    // ticket is a plain 401 pre-upgrade — and a replay never triggers the
    // presence lookup below (ordering: verify ticket → claim nonce → lookup).
    const replayed = !(await this.claimTicketNonce(claims.nonce, claims.exp));
    if (replayed) {
      return new Response('Realtime ticket has already been used', {
        status: 401,
      });
    }

    // Presence metadata (display name + role) is restored with ONE D1 lookup
    // (member+user join) after the ticket — the security boundary — is fully
    // validated. Connects are rare under the Hibernation API, so one query
    // per connect is negligible. Membership vanishing in the ≤60 s
    // mint→connect window (member removed, account deleted, or the lookup
    // itself failing) rejects here rather than connecting with stale identity.
    let member;
    try {
      member = await getProjectMember(this.env, claims.userId, projectId);
    } catch (error) {
      console.error('[realtime] connect membership lookup failed', error);
      return new Response('Realtime ticket holder is not a project member', {
        status: 401,
      });
    }
    if (!member) {
      return new Response('Realtime ticket holder is not a project member', {
        status: 401,
      });
    }

    // Same hibernation tags as the pre-ticket flow: real role + URL-encoded
    // display name from the membership row, user from the ticket, client id
    // from the WS request's `?clientId=` parameter. Roles can still change
    // after connect — the `members-changed` flow refreshes them from D1.
    const info: PresenceInfo = {
      userId: claims.userId,
      displayName: member.display_name ?? '',
      role: member.role,
      clientId: url.searchParams.get('clientId') ?? '',
    };

    const pair = new WebSocketPair();
    const socket = pair[1];
    // Tags persist across hibernation, so identity survives an idle wake.
    this.ctx.acceptWebSocket(socket, buildPresenceTags(info));

    socket.send(JSON.stringify({ type: 'hello' }));
    this.broadcastPresence();

    // Select exactly one subprotocol: the auth protocol we support (RFC 6455
    // requires the server response to name a single protocol, never the full
    // client list — the ticket itself must never be echoed back).
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { 'Sec-WebSocket-Protocol': REALTIME_AUTH_PROTOCOL },
    });
  }

  /**
   * Mark a ticket nonce consumed in DO storage (write-through, mirroring the
   * `RateLimiter` persistence pattern): a nonce already present means the
   * ticket was replayed. Consumed nonces whose ticket expiry is older than a
   * small slack are pruned opportunistically on every successful claim so the
   * store stays bounded without a background job.
   */
  private async claimTicketNonce(
    nonce: string,
    exp: number
  ): Promise<boolean> {
    const key = `${NONCE_STORAGE_PREFIX}${nonce}`;
    if ((await this.ctx.storage.get(key)) !== undefined) return false;
    await this.ctx.storage.put(key, exp);
    try {
      await this.pruneExpiredNonces(Math.floor(Date.now() / 1000));
    } catch (error) {
      // Pruning is opportunistic; a storage hiccup must not fail the connect.
      console.error('[realtime] nonce prune failed', error);
    }
    return true;
  }

  /** Delete consumed-nonce entries whose ticket expiry passed with slack. */
  private async pruneExpiredNonces(nowSec: number): Promise<void> {
    const entries = await this.ctx.storage.list({
      prefix: NONCE_STORAGE_PREFIX,
    });
    const expired: string[] = [];
    for (const [key, value] of entries) {
      if (
        typeof value === 'number' &&
        value + NONCE_PRUNE_SLACK_SECONDS < nowSec
      ) {
        expired.push(key);
      }
    }
    if (expired.length > 0) await this.ctx.storage.delete(expired);
  }

  private async handleNotify(request: Request): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    // Membership revocation / role change: re-verify every connected socket
    // against live D1 membership (posted by the membership handlers).
    if (isRecord(payload) && payload.type === 'members-changed') {
      const projectId =
        typeof payload.projectId === 'string' ? payload.projectId : '';
      if (!projectId) {
        return new Response('projectId is required', { status: 400 });
      }
      await this.handleMembersChanged(projectId);
      return new Response(null, { status: 204 });
    }

    const changes =
      isRecord(payload) && Array.isArray(payload.changes)
        ? (payload.changes as unknown[])
        : [];
    if (changes.length === 0) {
      return new Response(null, { status: 204 });
    }

    // Optional role floor: sockets whose effective role is below `minRole`
    // (e.g. a member downgraded since they connected) don't receive the frame.
    const minRole = isRecord(payload) && isRole(payload.minRole)
      ? payload.minRole
      : undefined;
    const message = JSON.stringify({ type: 'changes', changes });
    this.broadcastChanges(message, minRole ? { minRole } : {});
    return new Response(null, { status: 204 });
  }

  /**
   * Re-check every connected socket against live membership: users without a
   * `project_members` row have all their sockets closed; users with a row get
   * their cached role refreshed so later fan-out treats them by the new role.
   * A D1 failure fails open (nobody is disconnected on a transient error).
   */
  private async handleMembersChanged(projectId: string): Promise<void> {
    let roles: Map<string, Role>;
    try {
      roles = await fetchProjectRoles(this.env, projectId);
    } catch (error) {
      console.error('[realtime] members-changed: membership lookup failed', error);
      return;
    }

    const socketsByUser = new Map<string, WebSocket[]>();
    for (const ws of this.ctx.getWebSockets()) {
      const info = parsePresenceFromTags(this.ctx.getTags(ws));
      if (!info) continue;
      const sockets = socketsByUser.get(info.userId);
      if (sockets) sockets.push(ws);
      else socketsByUser.set(info.userId, [ws]);
    }

    for (const [userId, sockets] of socketsByUser) {
      const liveRole = roles.get(userId);
      if (!liveRole) {
        // Membership revoked: drop the user's cached state and close every
        // socket they still hold. 1008 = policy violation.
        this.roleOverrides.delete(userId);
        this.editingByUser.delete(userId);
        for (const ws of sockets) {
          try {
            ws.close(1008, 'Project access revoked');
          } catch {
            // Already closing; ignore.
          }
        }
        continue;
      }
      // Role changed (or unchanged): cache the live role so fan-out and
      // presence treat this member by their current role, not the stale tag.
      this.roleOverrides.set(userId, liveRole);
    }

    // Presence now reflects closures + refreshed roles.
    this.broadcastPresence();
  }

  /** Hibernation handler: keep-alive ping/pong. */
  async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string
  ): Promise<void> {
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
      return;
    }
    // A client reports which entity + field it is editing so collaborators can
    // see (and avoid clobbering) each other's in-progress edits. `field` may be
    // null to clear. Best-effort: a malformed frame is ignored.
    if (isRecord(parsed) && parsed.type === 'editing') {
      const info = parsePresenceFromTags(this.ctx.getTags(ws));
      if (info && typeof parsed.entityId === 'string') {
        if (parsed.field === null || parsed.field === undefined) {
          this.editingByUser.delete(info.userId);
        } else if (typeof parsed.field === 'string') {
          this.editingByUser.set(info.userId, {
            entityId: parsed.entityId,
            field: parsed.field,
          });
        }
        this.broadcastPresence();
      }
    }
  }

  /** Hibernation handler: a member left — refresh presence for the rest. */
  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    const info = parsePresenceFromTags(this.ctx.getTags(ws));
    if (info) {
      const stillHere = this.ctx
        .getWebSockets()
        .some((other) => other !== ws && this.userIdOf(other) === info.userId);
      if (!stillHere) this.editingByUser.delete(info.userId);
    }
    this.broadcastPresence();
  }

  /** Hibernation handler: close on error so presence recomputes. */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, 'WebSocket error');
  }

  private userIdOf(ws: WebSocket): string | null {
    return parsePresenceFromTags(this.ctx.getTags(ws))?.userId ?? null;
  }

  private broadcastPresence(): void {
    const editingByUser = Object.fromEntries(this.editingByUser);
    const roleOverrides = Object.fromEntries(this.roleOverrides);
    const users = presenceSnapshot(this.allSocketTags(), editingByUser, roleOverrides);
    this.broadcast(JSON.stringify({ type: 'presence', users }));
  }

  /** A socket's live role: refreshed override first, connect-time tag second. */
  private effectiveRoleOf(ws: WebSocket): Role {
    const info = parsePresenceFromTags(this.ctx.getTags(ws));
    if (!info) return 'viewer';
    return this.roleOverrides.get(info.userId) ?? info.role;
  }

  /**
   * Send a string to every connected (possibly hibernating) socket. When
   * `minRole` is set, sockets whose effective role is below it are skipped —
   * e.g. a member downgraded mid-session no longer receives editor frames.
   */
  private broadcast(message: string, options: { minRole?: Role } = {}): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (
        options.minRole &&
        !requireMinRole(this.effectiveRoleOf(ws), options.minRole)
      ) {
        continue;
      }
      try {
        ws.send(message);
      } catch {
        // A socket may be mid-close; skip it.
      }
    }
  }

  /**
   * Fan a serialized `changes` notification out to every connected socket.
   *
   * The socket set is collected ONCE per notification (a stable snapshot of
   * `getWebSockets()`), recipients are resolved from it up front, and each
   * socket is written with its own error isolation so one failing socket can
   * never block delivery to the others.
   *
   * Notifications over `REALTIME_MAX_MESSAGE_BYTES` are split into ordered
   * `{ type: 'changes-chunk', seq, total, payload }` frames: clients
   * concatenate the fragments of frames sharing a `total` by `seq` and
   * JSON.parse the result. At or under the threshold the message keeps
   * today's exact `changes` frame shape (no chunking, no wrapping).
   *
   * Hibernation note: this DO uses the WebSocket Hibernation API exclusively —
   * `ctx.getWebSockets()` is the single source of connected sockets (active
   * and hibernating alike) and the runtime exposes no predicate to tell them
   * apart, so fan-out sends to all of them. Writing to a hibernating socket is
   * cheap (the frame is buffered for delivery; the DO is not woken), so
   * "prefer non-hibernating sockets" degenerates safely to "send to all".
   */
  private broadcastChanges(
    message: string,
    options: { minRole?: Role } = {}
  ): void {
    const sockets = this.ctx.getWebSockets();
    const minRole = options.minRole;
    const recipients = minRole
      ? sockets.filter((ws) => requireMinRole(this.effectiveRoleOf(ws), minRole))
      : sockets;

    if (serializedByteLength(message) <= REALTIME_MAX_MESSAGE_BYTES) {
      for (const ws of recipients) {
        try {
          ws.send(message);
        } catch {
          // A socket may be mid-close; skip it.
        }
      }
      return;
    }

    const chunks = chunkNotification(message);
    const total = chunks.length;
    for (const ws of recipients) {
      for (let seq = 1; seq <= total; seq++) {
        try {
          ws.send(
            JSON.stringify({
              type: 'changes-chunk',
              seq,
              total,
              payload: chunks[seq - 1],
            })
          );
        } catch {
          // This socket failed mid-stream: abandon its remaining chunks (the
          // client discards an incomplete set and reconciles) but keep fanning
          // out to the remaining sockets.
          break;
        }
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

/**
 * Tell the project's `ProjectRoom` DO that membership changed (member removed
 * or role changed) so it re-checks every connected socket against live D1
 * membership and closes revoked sessions. Best-effort like `notifyRealtime`:
 * a failure is logged but must never fail the originating membership request.
 */
export async function notifyMembersChanged(
  env: Env,
  projectId: string
): Promise<void> {
  if (!env.PROJECT_ROOM) return;
  try {
    const id = env.PROJECT_ROOM.idFromName(projectId);
    const stub = env.PROJECT_ROOM.get(id);
    await stub.fetch(
      new Request('https://project-room.local/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'members-changed', projectId }),
      })
    );
  } catch (error) {
    console.error('[realtime] members-changed notify failed', error);
  }
}
