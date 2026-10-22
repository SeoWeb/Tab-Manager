import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  MIN_TOKEN_TTL_SECONDS,
  mintAccessToken,
  renewAccessToken,
  requireUser,
  requestLoginCode,
  verifyJwt,
  verifyJwtDetailed,
  verifyLoginCode,
  signJwt,
} from '../auth';
import worker from '../../index';
import type { Env } from '../../types';

const JWT_SECRET = 'test-secret-do-not-use-in-prod-123456';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- helpers -----------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface LoginCodeRow {
  email: string;
  code: string;
  expires_at: string;
  created_at: string;
  attempts: number;
  request_count: number;
  first_request_at: string;
}

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * In-memory D1 mock covering exactly the SQL shapes the auth paths issue
 * (login codes + users), with a full statement recorder so tests can assert
 * which queries (and writes) actually ran. Modeled on the mock in
 * `login-codes.test.ts`.
 */
function makeAuthEnv(
  seed: {
    users?: UserRow[];
    vars?: Record<string, string>;
    withEmail?: boolean;
  } = {}
): {
  env: Env;
  users: UserRow[];
  codes: LoginCodeRow[];
  sent: SentEmail[];
  statements: { sql: string; params: unknown[] }[];
  userStatements: { sql: string; params: unknown[] }[];
} {
  const users = seed.users ?? [];
  const codes: LoginCodeRow[] = [];
  const sent: SentEmail[] = [];
  const statements: { sql: string; params: unknown[] }[] = [];

  function upsertUser(params: unknown[]): void {
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
      // Models COALESCE(excluded.display_name, users.display_name).
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
  }

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async first(): Promise<unknown> {
              if (/FROM login_codes WHERE email = \?/.test(sql)) {
                return codes.find((c) => c.email === params[0]) ?? null;
              }
              if (/FROM users WHERE email = \?/.test(sql)) {
                return users.find((u) => u.email === params[0]) ?? null;
              }
              if (/FROM users WHERE id = \?/.test(sql)) {
                return users.find((u) => u.id === params[0]) ?? null;
              }
              return null;
            },
            async run(): Promise<{ meta: { changes: number } }> {
              if (/INSERT INTO users\b/.test(sql)) {
                upsertUser(params);
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO login_codes/.test(sql)) {
                const [email, code, expiresAt, createdAt, requestCount, firstRequestAt] =
                  params as [string, string, string, string, number, string];
                codes.push({
                  email,
                  code,
                  expires_at: expiresAt,
                  created_at: createdAt,
                  attempts: 0,
                  request_count: requestCount,
                  first_request_at: firstRequestAt,
                });
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM login_codes/.test(sql)) {
                if (/code = \?/.test(sql)) {
                  // Single-use consume (email + verifier + attempts + expiry).
                  const [email, verifier, maxAttempts, nowIso] = params as [
                    string,
                    string,
                    number,
                    string,
                  ];
                  const index = codes.findIndex(
                    (c) =>
                      c.email === email &&
                      c.code === verifier &&
                      c.attempts < maxAttempts &&
                      c.expires_at > nowIso
                  );
                  if (index === -1) return { meta: { changes: 0 } };
                  codes.splice(index, 1);
                  return { meta: { changes: 1 } };
                }
                if (/email = \?/.test(sql)) {
                  const [email, nowIso] = params as [string, string];
                  const index = codes.findIndex(
                    (c) => c.email === email && c.expires_at <= nowIso
                  );
                  if (index === -1) return { meta: { changes: 0 } };
                  codes.splice(index, 1);
                  return { meta: { changes: 1 } };
                }
                const nowIso = params[0] as string;
                const before = codes.length;
                for (let i = codes.length - 1; i >= 0; i -= 1) {
                  if (codes[i].expires_at <= nowIso) codes.splice(i, 1);
                }
                return { meta: { changes: before - codes.length } };
              }
              if (/UPDATE login_codes SET attempts = attempts \+ 1/.test(sql)) {
                const [email, maxAttempts, nowIso] = params as [
                  string,
                  number,
                  string,
                ];
                const row = codes.find(
                  (c) =>
                    c.email === email &&
                    c.attempts < maxAttempts &&
                    c.expires_at > nowIso
                );
                if (!row) return { meta: { changes: 0 } };
                row.attempts += 1;
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
    ...(seed.withEmail === false
      ? {}
      : {
          EMAIL: {
            async send(message: SentEmail) {
              sent.push(message);
              return { messageId: 'test-1' };
            },
          },
        }),
    ...seed.vars,
  } as unknown as Env;

  return {
    env,
    users,
    codes,
    sent,
    statements,
    // Every recorded statement that touches the users table (read or write).
    get userStatements() {
      return statements.filter((s) => /\busers\b/.test(s.sql));
    },
  };
}

/** Decode a JWT payload without verification (test introspection only). */
function decodePayload(token: string): {
  sub: string;
  email?: string;
  display_name?: string | null;
  iat?: number;
  exp?: number;
  jti?: string;
} {
  const [, payloadPart] = token.split('.');
  const padded = payloadPart.padEnd(
    payloadPart.length + ((4 - (payloadPart.length % 4)) % 4),
    '='
  );
  return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
}

function bearerRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Request {
  return new Request(`https://backend.test${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function errorStatusOf(response: Response): Promise<number> {
  const body = (await response.json()) as { error?: { message?: string } };
  expect(body.error).toBeDefined();
  return response.status;
}

/** Drive request-code until an email is sent; return the plaintext code. */
async function requestCodeAndGetCode(
  env: Env,
  email: string,
  sent: SentEmail[]
): Promise<string> {
  const response = await requestLoginCode(
    new Request('https://backend.test/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
    env
  );
  expect(response.status).toBe(202);
  const match = (sent[sent.length - 1]?.text ?? '').match(/\b\d{8}\b/);
  expect(match).not.toBeNull();
  return match![0];
}

const executionContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** Stub RATE_LIMITER namespace recording every key and applying `decide`. */
function stubRateLimiter(decide: (key: string) => {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}): { keys: string[]; namespace: DurableObjectNamespace } {
  const keys: string[] = [];
  const namespace = {
    idFromName(name: string) {
      keys.push(name);
      return name;
    },
    get(id: unknown) {
      const key = id as string;
      return {
        fetch: async () => Response.json(decide(key)),
      };
    },
  };
  return { keys, namespace: namespace as unknown as DurableObjectNamespace };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- 1.1 minting -------------------------------------------------------------

describe('mintAccessToken (centralized token mint)', () => {
  it('every minted token carries exp and jti', async () => {
    const { env } = makeAuthEnv();
    const token = await mintAccessToken(env, {
      sub: 'u1',
      email: 'u1@example.com',
      display_name: null,
    });

    const payload = decodePayload(token);
    expect(payload.jti).toMatch(UUID_RE);
    expect(payload.exp).toBeDefined();
    expect(payload.exp! - payload.iat!).toBe(DEFAULT_TOKEN_TTL_SECONDS);

    // And the token round-trips through verification.
    const verified = await verifyJwt(token, JWT_SECRET);
    expect(verified?.sub).toBe('u1');
    expect(verified?.jti).toBe(payload.jti);
  });

  it('two mints in the same instant produce distinct jti values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { env } = makeAuthEnv();

    const first = decodePayload(
      await mintAccessToken(env, { sub: 'u1', email: 'u1@example.com' })
    );
    const second = decodePayload(
      await mintAccessToken(env, { sub: 'u1', email: 'u1@example.com' })
    );

    // Same instant → identical iat/exp, but jti never collides.
    expect(second.iat).toBe(first.iat);
    expect(second.exp).toBe(first.exp);
    expect(second.jti).toMatch(UUID_RE);
    expect(first.jti).toMatch(UUID_RE);
    expect(second.jti).not.toBe(first.jti);
  });

  it('resolves TOKEN_TTL_SECONDS with the documented default and clamps', async () => {
    const cases: { vars: Record<string, string>; ttl: number }[] = [
      { vars: {}, ttl: DEFAULT_TOKEN_TTL_SECONDS },
      // 12-hour override applies as-is.
      { vars: { TOKEN_TTL_SECONDS: '43200' }, ttl: 43200 },
      // Above the 30-day cap → clamped.
      {
        vars: { TOKEN_TTL_SECONDS: String(MAX_TOKEN_TTL_SECONDS * 10) },
        ttl: MAX_TOKEN_TTL_SECONDS,
      },
      // Below the 1-minute floor → clamped.
      { vars: { TOKEN_TTL_SECONDS: '5' }, ttl: MIN_TOKEN_TTL_SECONDS },
      // Garbage → default.
      { vars: { TOKEN_TTL_SECONDS: 'soon' }, ttl: DEFAULT_TOKEN_TTL_SECONDS },
    ];

    for (const { vars, ttl } of cases) {
      const { env } = makeAuthEnv({ vars });
      const payload = decodePayload(
        await mintAccessToken(env, { sub: 'u1' })
      );
      expect(payload.exp! - payload.iat!).toBe(ttl);
    }
  });
});

// --- 1.1/1.2 verification: legacy flag + strict mode -------------------------

describe('verifyJwtDetailed (legacy flag + strict mode)', () => {
  it('reports legacy: false for a fully-formed token', async () => {
    const { env } = makeAuthEnv();
    const token = await mintAccessToken(env, { sub: 'u1' });
    const result = await verifyJwtDetailed(token, JWT_SECRET);
    expect(result).not.toBeNull();
    expect(result!.legacy).toBe(false);
  });

  it('flags a valid token without jti as legacy', async () => {
    const token = await signJwt(
      { sub: 'u1', iat: 100, exp: Math.floor(Date.now() / 1000) + 60 },
      JWT_SECRET
    );
    const result = await verifyJwtDetailed(token, JWT_SECRET);
    expect(result).not.toBeNull();
    expect(result!.legacy).toBe(true);
    expect(result!.payload.exp).toBe(Math.floor(Date.now() / 1000) + 60);
  });

  it('flags an exp-less token as legacy and keeps it valid by default', async () => {
    const token = await signJwt({ sub: 'u1', iat: 100 }, JWT_SECRET);
    const result = await verifyJwtDetailed(token, JWT_SECRET);
    expect(result).not.toBeNull();
    expect(result!.legacy).toBe(true);

    // The legacy verifyJwt wrapper still returns the payload (migration).
    expect((await verifyJwt(token, JWT_SECRET))?.sub).toBe('u1');
  });

  it('strict mode rejects an exp-less token but tolerates a jti-less one', async () => {
    const expLess = await signJwt({ sub: 'u1', iat: 100 }, JWT_SECRET);
    expect(
      await verifyJwtDetailed(expLess, JWT_SECRET, { requireExp: true })
    ).toBeNull();

    const jtiLess = await signJwt(
      { sub: 'u1', iat: 100, exp: Math.floor(Date.now() / 1000) + 60 },
      JWT_SECRET
    );
    const result = await verifyJwtDetailed(jtiLess, JWT_SECRET, {
      requireExp: true,
    });
    expect(result).not.toBeNull();
    expect(result!.legacy).toBe(true);
  });

  it('REQUIRE_EXP_ON_ALL_TOKENS=1 rejects exp-less tokens end to end', async () => {
    const strict = makeAuthEnv({ vars: { REQUIRE_EXP_ON_ALL_TOKENS: '1' } });
    const expLess = await signJwt({ sub: 'legacy-user' }, JWT_SECRET);

    const response = await requireUser(
      bearerRequest('GET', '/me', expLess),
      strict.env
    );
    expect(response instanceof Response).toBe(true);
    expect((response as Response).status).toBe(401);

    // An exp-bearing token (even jti-less) still works in strict mode.
    const strictOk = makeAuthEnv({
      vars: { REQUIRE_EXP_ON_ALL_TOKENS: '1' },
      users: [
        {
          id: 'u1',
          email: 'u1@example.com',
          display_name: null,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    const bearer = await signJwt(
      {
        sub: 'u1',
        email: 'u1@example.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      JWT_SECRET
    );
    const ok = await requireUser(bearerRequest('GET', '/me', bearer), strictOk.env);
    expect(ok).not.toBeInstanceOf(Response);
  });

  it('logs a legacy acceptance once per isolate, subject hashed only', async () => {
    vi.resetModules();
    // Fresh module instances so the once-per-isolate flag starts unset.
    const freshLogin = await import('../login');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = makeAuthEnv();
    const second = makeAuthEnv();
    const legacyA = await signJwt({ sub: 'legacy-subject-a' }, JWT_SECRET);
    const legacyB = await signJwt({ sub: 'legacy-subject-b' }, JWT_SECRET);

    const firstResult = await freshLogin.requireUser(
      bearerRequest('GET', '/me', legacyA),
      first.env
    );
    expect(firstResult).not.toBeInstanceOf(Response);
    const secondResult = await freshLogin.requireUser(
      bearerRequest('GET', '/me', legacyB),
      second.env
    );
    expect(secondResult).not.toBeInstanceOf(Response);

    // Rate-limited to one warning per isolate...
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.join(' ') ?? '';
    expect(message).toContain('legacy');
    expect(message).toMatch(/sha256:[0-9a-f]{12}/);
    // ...and never the raw subject, jti, or token.
    expect(message).not.toContain('legacy-subject-a');
    expect(message).not.toContain('legacy-subject-b');
    expect(message).not.toContain(JWT_SECRET);
  });

  it('counts legacy verifications per isolate for the daily census', async () => {
    vi.resetModules();
    const freshAuth = await import('../auth');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const flow = makeAuthEnv();
    const legacyA = await signJwt({ sub: 'legacy-count-a' }, JWT_SECRET);
    const legacyB = await signJwt({ sub: 'legacy-count-b' }, JWT_SECRET);

    const first = await freshAuth.requireUser(
      bearerRequest('GET', '/me', legacyA),
      flow.env
    );
    expect(first).not.toBeInstanceOf(Response);
    expect(freshAuth.legacyTokenVerificationCount()).toBe(1);

    const second = await freshAuth.requireUser(
      bearerRequest('GET', '/me', legacyB),
      flow.env
    );
    expect(second).not.toBeInstanceOf(Response);
    // The counter keeps running even though the warning is once-per-isolate;
    // the cron's scheduled() handler reports it as the daily census.
    expect(freshAuth.legacyTokenVerificationCount()).toBe(2);

    // The first (once-per-isolate) log carries the running count inline.
    expect(warnSpy.mock.calls[0].join(' ')).toContain(
      'legacy-token verifications since isolate start: 1'
    );
  });
});

// --- 1.3 /auth/verify mints the new format -----------------------------------

describe('verifyLoginCode minting (new TTL + jti)', () => {
  it('mints tokens that carry exp and jti', async () => {
    const flow = makeAuthEnv();
    const code = await requestCodeAndGetCode(flow.env, 'u@example.com', flow.sent);

    const response = await verifyLoginCode(
      new Request('https://backend.test/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'u@example.com', code }),
      }),
      flow.env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };

    const payload = decodePayload(body.token);
    expect(payload.jti).toMatch(UUID_RE);
    expect(payload.exp! - payload.iat!).toBe(DEFAULT_TOKEN_TTL_SECONDS);
  });

  it('two separate logins mint distinct jti values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const flow = makeAuthEnv();

    const code1 = await requestCodeAndGetCode(flow.env, 'u@example.com', flow.sent);
    const response1 = await verifyLoginCode(
      new Request('https://backend.test/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'u@example.com', code: code1 }),
      }),
      flow.env
    );
    const token1 = ((await response1.json()) as { token: string }).token;

    // Past the 30s resend throttle, then a second full login.
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    const code2 = await requestCodeAndGetCode(flow.env, 'u@example.com', flow.sent);
    const response2 = await verifyLoginCode(
      new Request('https://backend.test/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'u@example.com', code: code2 }),
      }),
      flow.env
    );
    const token2 = ((await response2.json()) as { token: string }).token;

    const jti1 = decodePayload(token1).jti;
    const jti2 = decodePayload(token2).jti;
    expect(jti1).toMatch(UUID_RE);
    expect(jti2).toMatch(UUID_RE);
    expect(jti2).not.toBe(jti1);
  });
});

// --- 1.4 POST /auth/renew ----------------------------------------------------

describe('POST /auth/renew', () => {
  it('renews with a fresh jti and the /auth/verify response shape', async () => {
    const flow = makeAuthEnv();
    const original = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
      display_name: null,
    });

    const response = await renewAccessToken(
      bearerRequest('POST', '/auth/renew', original),
      flow.env
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      token: string;
      user: { id: string; email: string; display_name: string | null };
    };
    // Same shape as /auth/verify's token response.
    expect(Object.keys(body).sort()).toEqual(['token', 'user']);
    expect(body.user).toEqual({
      id: 'u1',
      email: 'u1@example.com',
      display_name: null,
    });

    const before = decodePayload(original);
    const after = decodePayload(body.token);
    expect(after.jti).toMatch(UUID_RE);
    expect(after.jti).not.toBe(before.jti);
    expect(after.exp).toBeGreaterThanOrEqual(
      Math.floor(Date.now() / 1000) + MIN_TOKEN_TTL_SECONDS
    );
  });

  it('rejects an expired token with 401', async () => {
    const flow = makeAuthEnv();
    const expired = await signJwt(
      { sub: 'u1', email: 'u1@example.com', exp: 1 },
      JWT_SECRET
    );

    const response = await renewAccessToken(
      bearerRequest('POST', '/auth/renew', expired),
      flow.env
    );
    expect(await errorStatusOf(response)).toBe(401);
  });

  it('rejects a missing or invalid bearer token with 401', async () => {
    const flow = makeAuthEnv();
    const missing = await renewAccessToken(
      new Request('https://backend.test/auth/renew', { method: 'POST' }),
      flow.env
    );
    expect(await errorStatusOf(missing)).toBe(401);

    const invalid = await renewAccessToken(
      bearerRequest('POST', '/auth/renew', 'garbage.token.here'),
      flow.env
    );
    expect(await errorStatusOf(invalid)).toBe(401);
  });

  it('is classified in the authenticated (per-user) rate-limit tier', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });
    const limiter = stubRateLimiter(() => ({
      allowed: true,
      limit: 300,
      remaining: 299,
      resetAt: Date.now() + 60_000,
      retryAfter: 0,
    }));
    const env = { ...flow.env, RATE_LIMITER: limiter.namespace } as Env;

    const response = await worker.fetch(
      bearerRequest('POST', '/auth/renew', token),
      env,
      executionContext
    );
    expect(response.status).toBe(200);

    // Global per-IP tier first, then the user-keyed API tier — the renew
    // route carries a Bearer token, so it is classified as authenticated.
    expect(limiter.keys[0]).toBe('rl:global:ip:unknown');
    expect(limiter.keys).toContain('rl:api:user:u1');
    expect(limiter.keys.some((key) => key.startsWith('rl:api:ip:'))).toBe(
      false
    );
  });

  it('returns the rate-limit rejection (429) when the tier is exhausted', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });
    const limiter = stubRateLimiter((key) =>
      key.startsWith('rl:api:user:')
        ? {
            allowed: false,
            limit: 300,
            remaining: 0,
            resetAt: Date.now() + 60_000,
            retryAfter: 42,
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
      bearerRequest('POST', '/auth/renew', token),
      env,
      executionContext
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Too many requests');
  });
});

// --- 2.1 one verification per request ----------------------------------------

describe('single JWT verification per request (memoized getAuth)', () => {
  it('a request through rate limiting + requireUser verifies the HMAC once', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });
    const limiter = stubRateLimiter(() => ({
      allowed: true,
      limit: 300,
      remaining: 299,
      resetAt: Date.now() + 60_000,
      retryAfter: 0,
    }));
    const env = { ...flow.env, RATE_LIMITER: limiter.namespace } as Env;

    const verifySpy = vi.spyOn(crypto.subtle, 'verify');
    const response = await worker.fetch(
      bearerRequest('GET', '/me', token),
      env,
      executionContext
    );

    expect(response.status).toBe(200);
    // subjectOf (rate limiting) + requireUser (handler) shared one context.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(limiter.keys).toContain('rl:api:user:u1');
  });

  it('a fresh request verifies again (memo is request-scoped, not global)', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    const verifySpy = vi.spyOn(crypto.subtle, 'verify');
    await requireUser(bearerRequest('GET', '/me', token), flow.env);
    // A different Request object must not reuse the first request's context.
    await requireUser(bearerRequest('GET', '/me', token), flow.env);

    expect(verifySpy).toHaveBeenCalledTimes(2);
  });
});

// --- 2.2/2.3 read vs write user resolution -----------------------------------

/** Fresh seed row per call (tests mutate rows; never share one instance). */
function seededUser(): UserRow {
  return {
    id: 'u1',
    email: 'u1@example.com',
    display_name: null,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
  };
}

describe('read paths trust token claims (no user writes)', () => {
  it('a GET with a matching row performs a SELECT and zero user writes', async () => {
    const flow = makeAuthEnv({ users: [seededUser()] });
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    const user = await requireUser(bearerRequest('GET', '/me', token), flow.env);
    expect(user).not.toBeInstanceOf(Response);
    const resolved = user as UserRow;
    // Claims-trusted: the profile comes from the token.
    expect(resolved.id).toBe('u1');
    expect(resolved.email).toBe('u1@example.com');

    const writes = flow.userStatements.filter(
      (s) => /INSERT INTO users|UPDATE users/.test(s.sql)
    );
    expect(writes).toHaveLength(0);
  });

  it('the first-seen jti may upsert once; repeat requests do zero D1 work', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    // First GET: no row yet → the idempotent bookkeeping upsert is allowed.
    const first = await requireUser(
      bearerRequest('GET', '/me', token),
      flow.env
    );
    expect(first).not.toBeInstanceOf(Response);
    expect(flow.users.some((u) => u.id === 'u1')).toBe(true);
    const writesAfterFirst = flow.userStatements.filter((s) =>
      /INSERT INTO users|UPDATE users/.test(s.sql)
    );
    expect(writesAfterFirst.length).toBe(1);

    // Second GET with the same token (same jti): zero user-table statements.
    const statementsBefore = flow.statements.length;
    const second = await requireUser(
      bearerRequest('GET', '/me', token),
      flow.env
    );
    expect(second).not.toBeInstanceOf(Response);
    const newStatements = flow.statements.slice(statementsBefore);
    expect(newStatements.filter((s) => /\busers\b/.test(s.sql))).toHaveLength(0);
  });

  it('a GET trusts claims and stops touching the row after first-seen jti', async () => {
    const flow = makeAuthEnv({ users: [seededUser()] });
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
      display_name: 'New Name From Claims',
    });

    // First GET: the one-time bookkeeping upsert aligns the row with claims.
    const first = await requireUser(bearerRequest('GET', '/me', token), flow.env);
    expect(first).not.toBeInstanceOf(Response);
    expect(flow.users[0].display_name).toBe('New Name From Claims');

    // Simulate out-of-band drift: the row moves behind the token's claims.
    flow.users[0].display_name = null;

    // Second GET with the same token: claims-trusted response, zero D1 work,
    // and the row is NOT rewritten back into alignment by a read.
    const statementsBefore = flow.statements.length;
    const second = await requireUser(
      bearerRequest('GET', '/me', token),
      flow.env
    );
    expect(second).not.toBeInstanceOf(Response);
    expect((second as UserRow).display_name).toBe('New Name From Claims');
    expect(flow.users[0].display_name).toBeNull();
    expect(
      flow.statements.slice(statementsBefore).filter((s) => /\busers\b/.test(s.sql))
    ).toHaveLength(0);
  });

  it('a write request still upserts the user as before', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    const user = await requireUser(
      bearerRequest('POST', '/projects', token, { name: 'P' }),
      flow.env
    );
    expect(user).not.toBeInstanceOf(Response);

    // Write path kept today's behavior: SELECT + conditional upsert.
    const inserts = flow.userStatements.filter((s) =>
      /INSERT INTO users/.test(s.sql)
    );
    expect(inserts).toHaveLength(1);
    expect(flow.users).toHaveLength(1);
    // The resolved user is the DB row (created_at from the row, not claims).
    const resolved = user as UserRow;
    expect(resolved.created_at).toBe(flow.users[0].created_at);
  });

  it('a write request with a matching row takes the no-write fast path', async () => {
    const flow = makeAuthEnv({ users: [seededUser()] });
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
    });

    const user = await requireUser(
      bearerRequest('POST', '/projects', token, { name: 'P' }),
      flow.env
    );
    expect(user).not.toBeInstanceOf(Response);
    const writes = flow.userStatements.filter(
      (s) => /INSERT INTO users|UPDATE users/.test(s.sql)
    );
    expect(writes).toHaveLength(0);
    expect((user as UserRow).created_at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('GET /me returns the synthesized user with all User fields present', async () => {
    const flow = makeAuthEnv();
    const token = await mintAccessToken(flow.env, {
      sub: 'u1',
      email: 'u1@example.com',
      display_name: 'Ada',
    });

    const response = await worker.fetch(
      bearerRequest('GET', '/me', token),
      { ...flow.env, RATE_LIMITER: stubRateLimiter(() => ({
          allowed: true,
          limit: 300,
          remaining: 299,
          resetAt: Date.now() + 60_000,
          retryAfter: 0,
        })).namespace },
      executionContext
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: Record<string, unknown>;
    };
    expect(body.user.id).toBe('u1');
    expect(body.user.email).toBe('u1@example.com');
    expect(body.user.display_name).toBe('Ada');
    // The User type demands timestamp strings; reads synthesize them from the
    // token (no handler consumes them — audited).
    expect(typeof body.user.created_at).toBe('string');
    expect(typeof body.user.updated_at).toBe('string');
  });
});
