import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REALTIME_AUTH_PROTOCOL,
  REALTIME_TICKET_TTL_SECONDS,
  ProjectRoom,
  createRealtimeTicket,
  mintRealtimeTicket,
  parsePresenceFromTags,
  parseRealtimeAuthProtocols,
  verifyRealtimeTicket,
} from '../realtime';
import { mintAccessToken } from '../auth';
import worker from '../../index';
import type { Env } from '../../types';

const JWT_SECRET = 'test-secret-do-not-use-in-prod-123456';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- shared helpers ----------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  project_id: string;
  user_id: string;
  role: string;
}

/**
 * In-memory D1 mock covering the SQL the ticket endpoint touches:
 * requireUser's users SELECT/upsert and requireProjectAccess's member+user
 * join — with a statement recorder for the auth-tier assertions.
 */
function makeTicketEnv(
  seed: { users?: UserRow[]; members?: MemberRow[]; vars?: Record<string, string> } = {}
): { env: Env; users: UserRow[]; members: MemberRow[]; statements: { sql: string; params: unknown[] }[] } {
  const users = seed.users ?? [];
  const members = seed.members ?? [];
  const statements: { sql: string; params: unknown[] }[] = [];

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async first(): Promise<unknown> {
              if (/FROM users WHERE id = \?/.test(sql)) {
                return users.find((u) => u.id === params[0]) ?? null;
              }
              if (/FROM project_members pm\s+JOIN users u/.test(sql)) {
                const [projectId, userId] = params as [string, string];
                const member = members.find(
                  (m) => m.project_id === projectId && m.user_id === userId
                );
                if (!member) return null;
                const user = users.find((u) => u.id === userId);
                return {
                  id: `pm-${userId}`,
                  project_id: projectId,
                  user_id: userId,
                  role: member.role,
                  created_at: '2020-01-01T00:00:00.000Z',
                  updated_at: '2020-01-01T00:00:00.000Z',
                  email: user?.email ?? `${userId}@example.com`,
                  display_name: user?.display_name ?? null,
                };
              }
              return null;
            },
            async run(): Promise<{ meta: { changes: number } }> {
              if (/INSERT INTO users\b/.test(sql)) {
                const [id, email, displayName, createdAt, updatedAt] = params as [
                  string,
                  string,
                  string | null,
                  string,
                  string,
                ];
                const existing = users.find((u) => u.id === id);
                if (existing) {
                  existing.email = email;
                  existing.display_name = displayName ?? existing.display_name;
                  existing.updated_at = updatedAt;
                } else {
                  users.push({
                    id,
                    email,
                    display_name: displayName,
                    created_at: createdAt,
                    updated_at: updatedAt,
                  });
                }
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async all(): Promise<{ results: unknown[] }> {
              return { results: [] };
            },
          };
        },
      };
    },
  };

  const env = {
    D1_DATABASE: database,
    JWT_SECRET,
    ...seed.vars,
  } as unknown as Env;

  return { env, users, members, statements };
}

/**
 * Env for DO-upgrade tests: a seeded member `u1` on `p1` (editor) with a real
 * display name, so the connect-time presence lookup resolves fully.
 */
function makeRoomEnv(
  overrides: { members?: MemberRow[]; users?: UserRow[] } = {}
): ReturnType<typeof makeTicketEnv> {
  return makeTicketEnv({
    users: overrides.users ?? [
      {
        id: 'u1',
        email: 'u1@example.com',
        display_name: 'Ada Lovelace',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
    ],
    members: overrides.members ?? [
      { project_id: 'p1', user_id: 'u1', role: 'editor' },
    ],
  });
}

function bearerPost(path: string, token: string | null, body: unknown): Request {
  return new Request(`https://backend.test${path}`, {
    method: 'POST',
    headers: {
      ...(token === null
        ? {}
        : { Authorization: `Bearer ${token}` }),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const executionContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** Stub RATE_LIMITER namespace recording every key and applying `decide`. */
function stubRateLimiter(
  decide: (key: string) => {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetAt: number;
    retryAfter: number;
  }
): { keys: string[]; namespace: DurableObjectNamespace } {
  const keys: string[] = [];
  const namespace = {
    idFromName(name: string) {
      keys.push(name);
      return name;
    },
    get(id: unknown) {
      const key = id as string;
      return { fetch: async () => Response.json(decide(key)) };
    },
  };
  return { keys, namespace: namespace as unknown as DurableObjectNamespace };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --- 3.1 POST /realtime/ticket ----------------------------------------------

describe('POST /realtime/ticket', () => {
  it('mints a bound ticket with the documented response shape', async () => {
    const flow = makeTicketEnv({
      members: [{ project_id: 'p1', user_id: 'u1', role: 'editor' }],
    });
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    const response = await createRealtimeTicket(
      bearerPost('/realtime/ticket', token, { projectId: 'p1' }),
      flow.env
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ticket: string;
      expiresAt: number;
    };
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'ticket']);
    expect(REALTIME_TICKET_TTL_SECONDS).toBe(60);

    const [payloadPart, signaturePart] = body.ticket.split('.');
    expect(payloadPart).toBeTruthy();
    expect(signaturePart).toBeTruthy();
    const padded = payloadPart
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), '=');
    const payload = atob(padded);
    // rt:{userId}:{projectId}:{exp}:{nonce} — bound to caller + project.
    const uuidPattern = UUID_RE.source.replace(/^\^/, '').replace(/\$$/, '');
    expect(payload).toMatch(new RegExp(`^rt:u1:p1:\\d+:${uuidPattern}$`));
    const exp = Number.parseInt(payload.split(':')[3], 10);
    expect(body.expiresAt).toBe(exp);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      REALTIME_TICKET_TTL_SECONDS
    );
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(
      REALTIME_TICKET_TTL_SECONDS - 2
    );

    // And it verifies against the room's project id.
    const claims = await verifyRealtimeTicket(flow.env, body.ticket, 'p1');
    expect(claims).not.toBeNull();
    expect(claims!.userId).toBe('u1');
  });

  it('rejects a non-member with 403 (mint is the authorization grant)', async () => {
    const flow = makeTicketEnv(); // no membership rows
    const token = await mintAccessToken(flow.env, {
      sub: 'outsider',
      email: 'outsider@example.com',
    });

    const response = await createRealtimeTicket(
      bearerPost('/realtime/ticket', token, { projectId: 'p1' }),
      flow.env
    );
    expect(response.status).toBe(403);
  });

  it('rejects missing and invalid bearer tokens with 401', async () => {
    const flow = makeTicketEnv();

    const missing = await createRealtimeTicket(
      bearerPost('/realtime/ticket', null, { projectId: 'p1' }),
      flow.env
    );
    expect(missing.status).toBe(401);

    const invalid = await createRealtimeTicket(
      bearerPost('/realtime/ticket', 'garbage.token.here', { projectId: 'p1' }),
      flow.env
    );
    expect(invalid.status).toBe(401);
  });

  it('rejects a malformed body with 400', async () => {
    const flow = makeTicketEnv({
      members: [{ project_id: 'p1', user_id: 'u1', role: 'viewer' }],
    });
    const token = await mintAccessToken(flow.env, { sub: 'u1' });

    const noProject = await createRealtimeTicket(
      bearerPost('/realtime/ticket', token, {}),
      flow.env
    );
    expect(noProject.status).toBe(400);

    const emptyProject = await createRealtimeTicket(
      bearerPost('/realtime/ticket', token, { projectId: '' }),
      flow.env
    );
    expect(emptyProject.status).toBe(400);
  });

  it('is classified in the authenticated (per-user) rate-limit tier', async () => {
    const flow = makeTicketEnv({
      members: [{ project_id: 'p1', user_id: 'u1', role: 'viewer' }],
    });
    const token = await mintAccessToken(flow.env, { sub: 'u1' });
    const limiter = stubRateLimiter(() => ({
      allowed: true,
      limit: 300,
      remaining: 299,
      resetAt: Date.now() + 60_000,
      retryAfter: 0,
    }));
    const env = { ...flow.env, RATE_LIMITER: limiter.namespace } as Env;

    const response = await worker.fetch(
      bearerPost('/realtime/ticket', token, { projectId: 'p1' }),
      env,
      executionContext
    );
    expect(response.status).toBe(200);
    expect(limiter.keys[0]).toBe('rl:global:ip:unknown');
    expect(limiter.keys).toContain('rl:api:user:u1');
    expect(limiter.keys.some((key) => key.startsWith('rl:api:ip:'))).toBe(false);
  });

  it('returns the rate-limit rejection (429) when the tier is exhausted', async () => {
    const flow = makeTicketEnv({
      members: [{ project_id: 'p1', user_id: 'u1', role: 'viewer' }],
    });
    const token = await mintAccessToken(flow.env, { sub: 'u1' });
    const limiter = stubRateLimiter((key) =>
      key.startsWith('rl:api:user:')
        ? {
            allowed: false,
            limit: 300,
            remaining: 0,
            resetAt: Date.now() + 60_000,
            retryAfter: 7,
          }
        : {
            allowed: true,
            limit: 120,
            remaining: 119,
            resetAt: Date.now() + 60_000,
            retryAfter: 0,
          }
    );
    const env = { ...flow.env, RATE_LIMITER: limiter.namespace } as Env;

    const response = await worker.fetch(
      bearerPost('/realtime/ticket', token, { projectId: 'p1' }),
      env,
      executionContext
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('7');
  });
});

// --- ticket primitives -------------------------------------------------------

describe('realtime ticket primitives', () => {
  it('verifyRealtimeTicket round-trips a minted ticket', async () => {
    const env = makeTicketEnv().env;
    const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
    const claims = await verifyRealtimeTicket(env, ticket, 'p1');
    expect(claims).toMatchObject({ userId: 'u1', projectId: 'p1' });
    expect(claims!.nonce).toMatch(UUID_RE);
  });

  it('rejects a ticket bound to a different project', async () => {
    const env = makeTicketEnv().env;
    const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
    expect(await verifyRealtimeTicket(env, ticket, 'p2')).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const env = makeTicketEnv().env;
    const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
    const [payload, signature] = ticket.split('.');
    const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    expect(await verifyRealtimeTicket(env, `${payload}.${flipped}`, 'p1')).toBeNull();
  });

  it('rejects an expired ticket (valid HMAC, past exp)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const env = makeTicketEnv().env;
    const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(await verifyRealtimeTicket(env, ticket, 'p1')).toBeNull();
  });

  it('rejects a wrong-prefix payload even with a valid HMAC', async () => {
    const env = makeTicketEnv().env;
    // Sign an arbitrary non-`rt:` payload with the real secret.
    const payload = 'not-a-ticket:u1:p1:9999999999:nonce';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload)
    );
    const encode = (input: string | ArrayBuffer): string => {
      const binary =
        typeof input === 'string'
          ? btoa(input)
          : btoa(String.fromCharCode(...new Uint8Array(input)));
      return binary.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    };
    const forged = `${encode(payload)}.${encode(signature)}`;
    expect(await verifyRealtimeTicket(env, forged, 'p1')).toBeNull();
  });

  it('parseRealtimeAuthProtocols accepts exactly [protocol, ticket]', () => {
    expect(parseRealtimeAuthProtocols('tabspace-auth, tkt')).toBe('tkt');
    // Whitespace and empty entries are tolerated per RFC 6455 list parsing.
    expect(parseRealtimeAuthProtocols('tabspace-auth ,  tkt ,')).toBe('tkt');
    expect(parseRealtimeAuthProtocols(null)).toBeNull();
    expect(parseRealtimeAuthProtocols('')).toBeNull();
    // Missing protocol, missing ticket, extra entries: all fail closed.
    expect(parseRealtimeAuthProtocols('tkt')).toBeNull();
    expect(parseRealtimeAuthProtocols('other-proto, tkt')).toBeNull();
    expect(parseRealtimeAuthProtocols('tabspace-auth')).toBeNull();
    expect(parseRealtimeAuthProtocols('tabspace-auth, tkt, extra')).toBeNull();
  });
});

// --- 3.2/3.3 DO upgrade: ticket verification + single-use nonces --------------

/** Minimal fake socket: the DO only sends/closes on the server side. */
class FakeSocket {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  readyState = 1;
  send(message: string): void {
    this.sent.push(message);
  }
  close(code = 1000, reason = ''): void {
    this.closed = { code, reason };
  }
}

interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
  webSocket?: unknown;
}

/**
 * Permissive Response stand-in: undici (vitest's node runtime) refuses to
 * construct status-101 Responses, which the Workers runtime allows for
 * WebSocketPair handshakes. Asserts read status/headers/webSocket only.
 */
class FakeResponse {
  status: number;
  headers: Headers;
  webSocket: unknown;
  constructor(_body?: unknown, init: FakeResponseInit = {}) {
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
    this.webSocket = init.webSocket;
  }
}

interface DurableStorageShape {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[] | string): Promise<void>;
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
}

function makeRoomContext(
  data: Map<string, unknown> = new Map()
): {
  ctx: DurableObjectState;
  data: Map<string, unknown>;
  acceptCalls: { ws: WebSocket; tags: string[] }[];
} {
  const storage: DurableStorageShape = {
    async get(key) {
      return data.get(key);
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async list(options) {
      return new Map(
        [...data].filter(
          ([key]) => !options?.prefix || key.startsWith(options.prefix)
        )
      );
    },
  };
  const sockets: WebSocket[] = [];
  const tagsByWs = new Map<WebSocket, string[]>();
  const acceptCalls: { ws: WebSocket; tags: string[] }[] = [];
  const ctx = {
    storage,
    acceptWebSocket: vi.fn((ws: WebSocket, tags: string[]) => {
      acceptCalls.push({ ws, tags });
      sockets.push(ws);
      tagsByWs.set(ws, tags);
    }),
    getWebSockets: () => [...sockets],
    getTags: (ws: WebSocket) => tagsByWs.get(ws) ?? [],
  } as unknown as DurableObjectState;
  return { ctx, data, acceptCalls };
}

function upgradeRequest(
  projectId: string,
  options: {
    ticket?: string;
    protocolHeader?: string | null;
    clientId?: string;
    token?: string;
  } = {}
): Request {
  const headers: Record<string, string> = { Upgrade: 'websocket' };
  if (options.protocolHeader !== null) {
    headers['Sec-WebSocket-Protocol'] =
      options.protocolHeader ??
      `${REALTIME_AUTH_PROTOCOL}, ${options.ticket ?? ''}`;
  }
  const params = new URLSearchParams();
  if (options.clientId !== undefined) params.set('clientId', options.clientId);
  if (options.token !== undefined) params.set('token', options.token);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return new Request(
    `https://backend.test/projects/${projectId}/realtime${query}`,
    { headers }
  );
}

/**
 * Stub the Workers-only globals the upgrade path needs (WebSocketPair is not
 * defined in node; undici rejects status-101 Responses) and restore them
 * afterwards. All other tests in this file keep the real globals.
 */
async function withUpgradeStubs<T>(fn: () => Promise<T>): Promise<T> {
  class FakePair {
    0: FakeSocket = new FakeSocket();
    1: FakeSocket = new FakeSocket();
  }
  vi.stubGlobal('WebSocketPair', FakePair);
  vi.stubGlobal('Response', FakeResponse);
  try {
    return await fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('ProjectRoom upgrade auth (tickets + nonces)', () => {
  it('accepts a valid ticket, selects one subprotocol, and stamps presence identity', async () => {
    await withUpgradeStubs(async () => {
      const flow = makeRoomEnv();
      const { ctx, acceptCalls } = makeRoomContext();
      const room = new ProjectRoom(ctx, flow.env);
      const { ticket } = await mintRealtimeTicket(flow.env, 'u1', 'p1');

      const statementsBefore = flow.statements.length;
      const response = await room.fetch(
        upgradeRequest('p1', { ticket, clientId: 'ext-1' })
      );

      expect(response.status).toBe(101);
      // Exactly ONE selected protocol — never the ticket, never the list.
      expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(
        'tabspace-auth'
      );
      expect(REALTIME_AUTH_PROTOCOL).toBe('tabspace-auth');

      // Presence identity: user from the ticket, real display name + role
      // from the ONE connect-time membership lookup.
      expect(flow.statements.length - statementsBefore).toBe(1);
      expect(acceptCalls).toHaveLength(1);
      const info = parsePresenceFromTags(acceptCalls[0].tags);
      expect(info).toEqual({
        userId: 'u1',
        displayName: 'Ada Lovelace',
        role: 'editor',
        clientId: 'ext-1',
      });

      const serverSocket = acceptCalls[0].ws as unknown as FakeSocket;
      const hello = JSON.parse(serverSocket.sent[0]);
      expect(hello.type).toBe('hello');
      const presence = JSON.parse(serverSocket.sent[1]);
      expect(presence.type).toBe('presence');
      expect(presence.users).toEqual([
        { userId: 'u1', displayName: 'Ada Lovelace', role: 'editor' },
      ]);
    });
  });

  it('rejects the upgrade when membership vanished between mint and connect', async () => {
    await withUpgradeStubs(async () => {
      // No project_members rows: the ticket verifies, but the holder is gone.
      const flow = makeRoomEnv({ members: [] });
      const { ctx, acceptCalls } = makeRoomContext();
      const room = new ProjectRoom(ctx, flow.env);
      const { ticket } = await mintRealtimeTicket(flow.env, 'u1', 'p1');

      const response = await room.fetch(upgradeRequest('p1', { ticket }));
      expect(response.status).toBe(401);
      expect(acceptCalls).toHaveLength(0);
    });
  });

  it('membership in a different project does not grant this room', async () => {
    await withUpgradeStubs(async () => {
      // u1 belongs to p2 only; the p1 room must not admit them even though a
      // p1-bound ticket verifies (the lookup filters on the project binding).
      const flow = makeRoomEnv({
        members: [{ project_id: 'p2', user_id: 'u1', role: 'owner' }],
      });
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, flow.env);
      const { ticket } = await mintRealtimeTicket(flow.env, 'u1', 'p1');

      const response = await room.fetch(upgradeRequest('p1', { ticket }));
      expect(response.status).toBe(401);
    });
  });

  it('rejects the upgrade when the membership lookup fails (D1 error)', async () => {
    await withUpgradeStubs(async () => {
      const brokenEnv = {
        JWT_SECRET,
        D1_DATABASE: {
          prepare: () => {
            throw new Error('d1 unavailable');
          },
        },
      } as unknown as Env;
      const { ctx, acceptCalls } = makeRoomContext();
      const room = new ProjectRoom(ctx, brokenEnv);
      const { ticket } = await mintRealtimeTicket(brokenEnv, 'u1', 'p1');

      const response = await room.fetch(upgradeRequest('p1', { ticket }));
      expect(response.status).toBe(401);
      expect(acceptCalls).toHaveLength(0);
    });
  });

  it('rejects the same ticket twice (single-use nonce, no lookup on replay)', async () => {
    await withUpgradeStubs(async () => {
      const flow = makeRoomEnv();
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, flow.env);
      const { ticket } = await mintRealtimeTicket(flow.env, 'u1', 'p1');

      const first = await room.fetch(upgradeRequest('p1', { ticket }));
      expect(first.status).toBe(101);

      // The replay is rejected from the nonce store alone: it must never
      // trigger the connect-time membership lookup.
      const statementsBefore = flow.statements.length;
      const replay = await room.fetch(upgradeRequest('p1', { ticket }));
      expect(replay.status).toBe(401);
      expect(flow.statements.length).toBe(statementsBefore);
    });
  });

  it('nonce store survives a DO restart (write-through to storage)', async () => {
    await withUpgradeStubs(async () => {
      const env = makeRoomEnv().env;
      // Shared storage map: the "restarted" instance adopts the persisted
      // nonces exactly like a real evicted-and-rehydrated DO would.
      const sharedStorage = new Map<string, unknown>();
      const before = makeRoomContext(sharedStorage);
      const first = new ProjectRoom(before.ctx, env);
      const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
      expect((await first.fetch(upgradeRequest('p1', { ticket }))).status).toBe(
        101
      );

      const after = makeRoomContext(sharedStorage);
      const restarted = new ProjectRoom(after.ctx, env);
      const replay = await restarted.fetch(upgradeRequest('p1', { ticket }));
      expect(replay.status).toBe(401);
    });
  });

  it('rejects expired, malformed, and wrong-project tickets pre-upgrade', async () => {
    await withUpgradeStubs(async () => {
      const env = makeTicketEnv().env;
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, env);

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
      vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
      expect((await room.fetch(upgradeRequest('p1', { ticket }))).status).toBe(
        401
      );
      vi.useRealTimers();

      const fresh = await mintRealtimeTicket(env, 'u1', 'p1');
      // Malformed: no dot-separated signature.
      expect(
        (await room.fetch(upgradeRequest('p1', { ticket: 'garbage' }))).status
      ).toBe(401);
      // Valid ticket, wrong room: the p1 ticket cannot open the p2 room.
      expect(
        (
          await room.fetch(upgradeRequest('p2', { ticket: fresh.ticket }))
        ).status
      ).toBe(401);
      // Handshake shape: wrong protocol, missing ticket, extra entries.
      expect(
        (
          await room.fetch(
            upgradeRequest('p1', {
              protocolHeader: 'other-proto, x.y',
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await room.fetch(
            upgradeRequest('p1', { protocolHeader: REALTIME_AUTH_PROTOCOL })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await room.fetch(
            upgradeRequest('p1', {
              protocolHeader: `${REALTIME_AUTH_PROTOCOL}, a.b, extra`,
            })
          )
        ).status
      ).toBe(401);
      expect(
        (await room.fetch(upgradeRequest('p1', { protocolHeader: null })))
          .status
      ).toBe(401);
    });
  });

  it('never reads ?token= from the URL', async () => {
    await withUpgradeStubs(async () => {
      const flow = makeTicketEnv({
        members: [{ project_id: 'p1', user_id: 'u1', role: 'viewer' }],
      });
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, flow.env);

      // A stale ?token= alongside a valid ticket is ignored: the ticket wins.
      const staleToken = await mintAccessToken(flow.env, { sub: 'u1' });
      const { ticket } = await mintRealtimeTicket(flow.env, 'u1', 'p1');
      const withToken = await room.fetch(
        upgradeRequest('p1', { ticket, token: staleToken, clientId: 'c1' })
      );
      expect(withToken.status).toBe(101);

      // ?token= alone (no subprotocol ticket) is rejected.
      const tokenOnly = await room.fetch(
        upgradeRequest('p1', { protocolHeader: null, token: staleToken })
      );
      expect(tokenOnly.status).toBe(401);
    });
  });

  it('prunes consumed nonces past their expiry slack', async () => {
    await withUpgradeStubs(async () => {
      const env = makeRoomEnv().env;
      const { ctx, data } = makeRoomContext();
      const room = new ProjectRoom(ctx, env);

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const first = await mintRealtimeTicket(env, 'u1', 'p1');
      expect(
        (await room.fetch(upgradeRequest('p1', { ticket: first.ticket })))
          .status
      ).toBe(101);
      expect(data.size).toBe(1);
      const firstKey = [...data.keys()][0];

      // Beyond expiry + prune slack: the next successful claim reaps the
      // dead nonce so the store stays bounded.
      vi.setSystemTime(new Date('2026-01-01T00:07:00Z'));
      const second = await mintRealtimeTicket(env, 'u1', 'p1');
      expect(
        (await room.fetch(upgradeRequest('p1', { ticket: second.ticket })))
          .status
      ).toBe(101);
      expect(data.has(firstKey)).toBe(false);
      expect(data.size).toBe(1);
    });
  });

  it('rejects non-upgrade requests with 426 (unchanged contract)', async () => {
    await withUpgradeStubs(async () => {
      const env = makeTicketEnv().env;
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, env);
      const response = await room.fetch(
        new Request('https://backend.test/projects/p1/realtime')
      );
      expect(response.status).toBe(426);
    });
  });
});

// --- worker-level routing ------------------------------------------------------

describe('realtime routing (worker fetch)', () => {
  /** Namespace stub binding every project id to one real DO instance. */
  function roomNamespace(room: ProjectRoom): DurableObjectNamespace {
    return {
      idFromName: (name: string) => ({ name }),
      get: () => ({ fetch: (request: Request) => room.fetch(request) }),
    } as unknown as DurableObjectNamespace;
  }

  it('upgrades with a valid subprotocol ticket; 401 without one', async () => {
    await withUpgradeStubs(async () => {
      const env = makeRoomEnv().env;
      const { ctx } = makeRoomContext();
      const room = new ProjectRoom(ctx, env);
      const workerEnv = {
        JWT_SECRET,
        PROJECT_ROOM: roomNamespace(room),
      } as Env;

      const { ticket } = await mintRealtimeTicket(env, 'u1', 'p1');
      const ok = await worker.fetch(
        upgradeRequest('p1', { ticket, clientId: 'c1' }),
        workerEnv,
        executionContext
      );
      expect(ok.status).toBe(101);
      expect(ok.headers.get('Sec-WebSocket-Protocol')).toBe('tabspace-auth');

      const denied = await worker.fetch(
        upgradeRequest('p1', { protocolHeader: null }),
        workerEnv,
        executionContext
      );
      expect(denied.status).toBe(401);
    });
  });
});
