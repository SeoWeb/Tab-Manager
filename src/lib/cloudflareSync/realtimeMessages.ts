import type { CloudPresenceUser, CloudSyncChange } from './types';

/**
 * Pure realtime message handling (Phase 5), kept separate from the WebSocket
 * client so it has no dependency on the Zustand store singleton and can be unit
 * tested in isolation.
 *
 * Chunked fan-out (scale-sync-backend): oversized `changes` notifications
 * arrive as ordered `{ type: 'changes-chunk', seq, total, payload }` frames —
 * string fragments of ONE serialized `{ type: 'changes', changes: [...] }`
 * message. Frames of a group share the same `total`; we buffer `payload` by
 * `seq`, and once every seq in 1..total has arrived we concatenate in order,
 * JSON.parse, and dispatch exactly like a normal `changes` frame. Notifications
 * at or under the server's size cap keep today's plain `changes` frame shape
 * and never touch the buffer.
 */

/** The minimal store surface `handleRealtimeMessage` touches (for testability). */
export interface RealtimeStoreLike {
  mergeRemoteChanges: (changes: CloudSyncChange[], clientId: string) => void;
  setProjectCursor: (projectId: string, cursor: number) => void;
  setOnlinePresence: (users: CloudPresenceUser[]) => void;
  cloudSync?: { cursors?: Record<string, number> };
}

/**
 * Build the WebSocket URL from the configured HTTP Worker base.
 *
 * Auth (harden-auth-tokens): the access token and the one-time ticket are
 * NEVER carried in the URL — they travel in the `Sec-WebSocket-Protocol` field
 * during the handshake (`tabspace-auth`, <ticket>). Only the non-secret
 * `clientId` rides in the query string so the server can attribute echoes.
 */
export function realtimeUrl(
  httpBase: string,
  projectId: string,
  clientId: string
): string {
  const base = httpBase.replace(/\/+$/, '');
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const params = new URLSearchParams({ clientId });
  return `${wsBase}/projects/${encodeURIComponent(projectId)}/realtime?${params.toString()}`;
}

/** A `total` above this is never buffered — protocol guard against abuse. */
const MAX_CHUNK_GROUP_TOTAL = 1000;

/** An in-progress chunk group: fragments of one notification keyed by `seq`. */
interface ChunkGroup {
  total: number;
  parts: Map<number, string>;
}

/**
 * Open chunk groups keyed by `total`. Module-level because the extension holds
 * at most one realtime socket (see `realtime.ts`); reset on connect/disconnect
 * so a fresh connection can never inherit stale partial groups.
 */
let chunkGroups: Map<number, ChunkGroup> = new Map();

/**
 * Drop every partially-received chunk group. Called when the socket (re)opens
 * or is deliberately closed: an interrupted stream can never complete, and the
 * change log is re-fetched on the next sync, so dropping is the safe move.
 */
export function resetRealtimeChunkBuffer(): void {
  chunkGroups = new Map();
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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

  const msg = message as {
    type?: unknown;
    changes?: unknown;
    users?: unknown;
    seq?: unknown;
    total?: unknown;
    payload?: unknown;
  };

  if (msg.type === 'changes-chunk') {
    return handleChunkFrame(msg, deps);
  }

  // Protocol safety: any non-chunk frame while a chunk group is open means the
  // group's frame stream was interrupted (the server sends a group's frames
  // back-to-back) — drop the partial assembly rather than dispatch a guess.
  if (chunkGroups.size > 0) {
    chunkGroups = new Map();
  }

  if (msg.type === 'changes' && Array.isArray(msg.changes)) {
    dispatchChanges(msg.changes as CloudSyncChange[], deps);
    return true;
  }

  if (msg.type === 'presence' && Array.isArray(msg.users)) {
    deps.store.setOnlinePresence(msg.users as CloudPresenceUser[]);
    return true;
  }

  // 'hello' / 'pong' / unknown -> ignored.
  return false;
}

/** The single dispatch path shared by `changes` frames and reassembled groups. */
function dispatchChanges(
  changes: CloudSyncChange[],
  deps: { clientId: string; store: RealtimeStoreLike }
): void {
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
}

/**
 * Buffer one `changes-chunk` frame. Frames whose seq/total are not positive
 * integers, whose total exceeds the guard cap, whose seq overshoots its total,
 * or whose payload is not a string are ignored. A duplicate `seq` overwrites
 * the earlier fragment. When all of 1..total are present the group is
 * assembled, parsed, validated like a normal `changes` message, dispatched,
 * and its buffer cleared.
 */
function handleChunkFrame(
  msg: { seq?: unknown; total?: unknown; payload?: unknown },
  deps: { clientId: string; store: RealtimeStoreLike }
): boolean {
  const { seq, total, payload } = msg;
  if (
    !isPositiveInt(seq) ||
    !isPositiveInt(total) ||
    total > MAX_CHUNK_GROUP_TOTAL ||
    seq > total ||
    typeof payload !== 'string'
  ) {
    return false;
  }

  let group = chunkGroups.get(total);
  if (!group) {
    group = { total, parts: new Map() };
    chunkGroups.set(total, group);
  }
  group.parts.set(seq, payload);
  if (group.parts.size < total) return true; // buffered; waiting on the rest

  // Complete: take the group out first so a failure below can never leave a
  // half-dispatched group behind, then concatenate in seq order.
  chunkGroups.delete(total);
  let serialized = '';
  for (let s = 1; s <= total; s++) {
    serialized += group.parts.get(s) ?? '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    // Garbled assembly (lost/corrupt fragment): drop silently — the next
    // incremental sync reconciles the missed changes.
    return true;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === 'changes' &&
    Array.isArray((parsed as { changes?: unknown }).changes)
  ) {
    dispatchChanges((parsed as { changes: CloudSyncChange[] }).changes, deps);
  }
  return true;
}
