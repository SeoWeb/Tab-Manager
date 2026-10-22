import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CODE_ATTEMPTS,
  encodeLoginCode,
  generateLoginCode,
  hashLoginCode,
  purgeExpiredLoginCodes,
  requestLoginCode,
  verifyLoginCode,
} from '../login';
import { verifyJwt } from '../jwt';
import { loginRequestSchema, parseBody } from '../validation';
import type { Env } from '../../types';

const JWT_SECRET = 'test-secret-do-not-use-in-prod-123456';

interface LoginCodeRow {
  email: string;
  /** Stored verifier `<salt>$<sha-256(salt:code)>` — never the plaintext. */
  code: string;
  display_name: string | null;
  expires_at: string;
  created_at: string;
  attempts: number;
  request_count: number;
  first_request_at: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * In-memory D1 mock covering exactly the SQL shapes `login.ts` issues, with
 * real row predicates so `meta.changes` behaves like D1: a conditional
 * DELETE/UPDATE that matches nothing reports 0 changes — which is precisely
 * the mechanism that makes the verify path atomic.
 */
function makeLoginEnv(
  seed: { codes?: LoginCodeRow[]; users?: UserRow[]; withEmail?: boolean } = {}
): {
  env: Env;
  codes: LoginCodeRow[];
  users: UserRow[];
  sent: SentEmail[];
  statements: { sql: string; params: unknown[] }[];
} {
  const codes = seed.codes ?? [];
  const users = seed.users ?? [];
  const sent: SentEmail[] = [];
  const statements: { sql: string; params: unknown[] }[] = [];

  function exec(
    sql: string,
    params: unknown[]
  ): { meta: { changes: number } } {
    if (/DELETE FROM login_codes/.test(sql)) {
      if (/code = \?/.test(sql)) {
        // Single-use consume: email + verifier + attempts < max + not expired.
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
        // Expired-row purge for one address (guarded by expires_at <= now).
        const [email, nowIso] = params as [string, string];
        const index = codes.findIndex(
          (c) => c.email === email && c.expires_at <= nowIso
        );
        if (index === -1) return { meta: { changes: 0 } };
        codes.splice(index, 1);
        return { meta: { changes: 1 } };
      }
      // Global expired purge.
      const nowIso = params[0] as string;
      const before = codes.length;
      for (let i = codes.length - 1; i >= 0; i -= 1) {
        if (codes[i].expires_at <= nowIso) codes.splice(i, 1);
      }
      return { meta: { changes: before - codes.length } };
    }

    if (/UPDATE login_codes SET attempts = attempts \+ 1/.test(sql)) {
      // Atomic attempt increment: email + attempts < max + not expired.
      const [email, maxAttempts, nowIso] = params as [string, number, string];
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

    if (/INSERT INTO login_codes/.test(sql)) {
      const [email, code, expiresAt, createdAt, requestCount, firstRequestAt] =
        params as [string, string, string, string, number, string];
      const existing = codes.find((c) => c.email === email);
      if (existing) {
        existing.code = code;
        existing.expires_at = expiresAt;
        existing.created_at = createdAt;
        existing.attempts = 0;
        existing.request_count = requestCount;
        existing.first_request_at = firstRequestAt;
      } else {
        codes.push({
          email,
          code,
          display_name: null,
          expires_at: expiresAt,
          created_at: createdAt,
          attempts: 0,
          request_count: requestCount,
          first_request_at: firstRequestAt,
        });
      }
      return { meta: { changes: 1 } };
    }

    if (/INSERT INTO users/.test(sql)) {
      const [id, email, createdAt, updatedAt] = params as [
        string,
        string,
        string,
        string,
      ];
      users.push({
        id,
        email,
        display_name: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async first() {
              if (/FROM login_codes WHERE email = \?/.test(sql)) {
                return codes.find((c) => c.email === params[0]) ?? null;
              }
              if (/FROM users WHERE email = \?/.test(sql)) {
                return users.find((u) => u.email === params[0]) ?? null;
              }
              return null;
            },
            async run() {
              return exec(sql, params);
            },
            async all() {
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
  } as unknown as Env;

  return { env, codes, users, sent, statements };
}

// --- helpers -----------------------------------------------------------------

function post(path: string, body: unknown): Request {
  return new Request(`https://backend.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedCode(overrides: Partial<LoginCodeRow> = {}): LoginCodeRow {
  const now = new Date();
  return {
    email: 'user@example.com',
    code: 'unused',
    display_name: null,
    expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    created_at: now.toISOString(),
    attempts: 0,
    request_count: 1,
    first_request_at: now.toISOString(),
    ...overrides,
  };
}

async function requestCode(
  env: Env,
  email: string,
  extra: Record<string, unknown> = {}
): Promise<Response> {
  return requestLoginCode(post('/auth/request-code', { email, ...extra }), env);
}

/** Drive request-code until an email is sent; return the plaintext code. */
async function requestCodeAndGetCode(
  env: Env,
  email: string,
  sent: SentEmail[]
): Promise<string> {
  const response = await requestCode(env, email);
  expect(response.status).toBe(202);
  const body = sent[sent.length - 1]?.text ?? '';
  const match = body.match(/\b\d{8}\b/);
  expect(match).not.toBeNull();
  return match![0];
}

function verifyCode(
  env: Env,
  email: string,
  code: string
): Promise<Response> {
  return verifyLoginCode(post('/auth/verify', { email, code }), env);
}

async function errorOf(
  response: Response
): Promise<{ status: number; message: string }> {
  const body = (await response.json()) as { error: { message: string } };
  return { status: response.status, message: body.error.message };
}

afterEach(() => {
  vi.useRealTimers();
});

// --- tests -------------------------------------------------------------------

describe('generateLoginCode (rejection sampling)', () => {
  it('always produces zero-padded 8-digit numeric codes', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(generateLoginCode()).toMatch(/^\d{8}$/);
    }
  });

  it('is uniform across the code space (no modulo bias)', () => {
    // With n=1000 the lower-half share has σ ≈ 0.016; [0.4, 0.6] is > 6σ, so
    // a modulo-biased implementation (skewing ~9.5% toward low codes) fails
    // reliably while a fair one practically never does.
    let lowerHalf = 0;
    const runs = 1000;
    for (let i = 0; i < runs; i += 1) {
      if (Number(generateLoginCode()) < 50_000_000) lowerHalf += 1;
    }
    expect(lowerHalf / runs).toBeGreaterThan(0.4);
    expect(lowerHalf / runs).toBeLessThan(0.6);
  });
});

describe('codes are hashed at rest', () => {
  it('stores a salted verifier, never the plaintext code', async () => {
    const { env, codes, sent, statements } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);

    expect(codes).toHaveLength(1);
    const stored = codes[0].code;
    // Not the plaintext, and exactly `<32 hex salt>$<64 hex sha-256>`.
    expect(stored).not.toBe(code);
    expect(stored).not.toContain(code);
    expect(stored).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);

    // Same guarantee at the write: the INSERT bound the verifier, not the code.
    const insert = statements.find((s) => /INSERT INTO login_codes/.test(s.sql));
    expect(insert?.params[1]).toBe(stored);
  });

  it('verifies via the stored salt + hash path', async () => {
    const { env, codes, sent } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);
    const [salt, digest] = codes[0].code.split('$');

    // The stored digest is exactly sha-256(salt:code) for the stored salt.
    expect(await hashLoginCode(salt, code)).toBe(digest);

    // And the flow accepts the plaintext code against that verifier.
    const response = await verifyCode(env, 'user@example.com', code);
    expect(response.status).toBe(200);
  });

  it('rotates to a fresh salt on resend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { env, codes, sent } = makeLoginEnv();

    const first = await requestCodeAndGetCode(env, 'user@example.com', sent);
    const firstStored = codes[0].code;

    // Past the 30s resend throttle.
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    const second = await requestCodeAndGetCode(env, 'user@example.com', sent);

    expect(second).not.toBe(first);
    expect(codes[0].code).not.toBe(firstStored);
    // New salt, new digest; still a well-formed verifier for the new code.
    expect(codes[0].code).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    const [salt, digest] = codes[0].code.split('$');
    expect(await hashLoginCode(salt, second)).toBe(digest);
  });
});

describe('single-use verification (atomic consume)', () => {
  it('mints exactly one token; a second verify of the same code fails', async () => {
    const { env, codes, sent, users } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);

    // First verify: consumes the row and mints a valid JWT.
    const first = await verifyCode(env, 'user@example.com', code);
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      token: string;
      user: { email: string; display_name: string | null };
    };
    const payload = await verifyJwt(body.token, JWT_SECRET);
    expect(payload?.email).toBe('user@example.com');
    expect(payload?.sub).toBe(users[0].id);

    // The row is gone: the concurrent-verify loser finds nothing to consume.
    expect(codes).toHaveLength(0);
    const second = await verifyCode(env, 'user@example.com', code);
    expect(second.status).toBe(401);
    expect((await errorOf(second)).message).toBe('Invalid or expired code');
  });

  it('consumes with a single conditional DELETE (no read-then-delete)', async () => {
    const { env, sent, statements } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);
    const response = await verifyCode(env, 'user@example.com', code);
    expect(response.status).toBe(200);

    const deletes = statements.filter((s) => /DELETE FROM login_codes/.test(s.sql));
    // Exactly one consume statement, and it is conditional on the verifier,
    // the attempt cap, and expiry — the atomicity guarantee itself.
    const consume = deletes.filter((s) => /code = \?/.test(s.sql));
    expect(consume).toHaveLength(1);
    expect(consume[0].sql).toContain('AND attempts < ?');
    expect(consume[0].sql).toContain('AND expires_at > ?');
    expect(consume[0].params[1]).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(consume[0].params[2]).toBe(MAX_CODE_ATTEMPTS);
  });

  it('a wrong code does not consume; the correct code still verifies', async () => {
    const { env, codes, sent } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);

    const wrong = await verifyCode(env, 'user@example.com', '00000000');
    expect(wrong.status).toBe(401);
    expect((await errorOf(wrong)).message).toBe('Incorrect code');
    expect(codes).toHaveLength(1); // not consumed
    expect(codes[0].attempts).toBe(1);

    const right = await verifyCode(env, 'user@example.com', code);
    expect(right.status).toBe(200);
    expect(codes).toHaveLength(0);
  });
});

describe('brute-force attempt cap', () => {
  it('invalidates the code after MAX wrong attempts, even for the right code', async () => {
    const { env, codes, sent, users } = makeLoginEnv();

    const code = await requestCodeAndGetCode(env, 'user@example.com', sent);
    const wrongCodes = ['00000000', '11111111', '22222222', '33333333', '44444444'];

    for (const wrong of wrongCodes.slice(0, MAX_CODE_ATTEMPTS)) {
      const response = await verifyCode(env, 'user@example.com', wrong);
      expect(response.status).toBe(401);
      expect((await errorOf(response)).message).toBe('Incorrect code');
    }
    expect(codes[0].attempts).toBe(MAX_CODE_ATTEMPTS);

    // Cap reached: even the correct code is dead, and nothing is consumed.
    const correct = await verifyCode(env, 'user@example.com', code);
    expect(correct.status).toBe(401);
    expect((await errorOf(correct)).message).toBe(
      'Too many attempts. Please request a new code.'
    );
    expect(codes).toHaveLength(1);
    expect(codes[0].attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(users).toHaveLength(0); // no token/user was ever minted
  });

  it('enforces a cap already stored in the DB (restart simulation)', async () => {
    // Rows at cap (e.g. written before a restart) must be inert.
    const atCap = makeLoginEnv({
      codes: [seedCode({ code: await encodeLoginCode('12345678'), attempts: MAX_CODE_ATTEMPTS })],
    });
    const capped = await verifyCode(atCap.env, 'user@example.com', '12345678');
    expect(capped.status).toBe(401);
    expect((await errorOf(capped)).message).toBe(
      'Too many attempts. Please request a new code.'
    );
    expect(atCap.codes[0].attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(atCap.codes).toHaveLength(1); // not consumed, not reset

    // Rows one below cap accept exactly one more wrong attempt, then lock.
    const nearCap = makeLoginEnv({
      codes: [seedCode({ code: await encodeLoginCode('12345678'), attempts: MAX_CODE_ATTEMPTS - 1 })],
    });
    const wrong = await verifyCode(nearCap.env, 'user@example.com', '00000000');
    expect(wrong.status).toBe(401);
    expect(nearCap.codes[0].attempts).toBe(MAX_CODE_ATTEMPTS);

    const right = await verifyCode(nearCap.env, 'user@example.com', '12345678');
    expect(right.status).toBe(401);
    expect((await errorOf(right)).message).toBe(
      'Too many attempts. Please request a new code.'
    );
    expect(nearCap.codes).toHaveLength(1);
  });
});

describe('expired codes are rejected and purged', () => {
  it('rejects an expired code on verify and deletes the row', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString();
    const { env, codes } = makeLoginEnv({
      codes: [
        seedCode({ code: await encodeLoginCode('12345678'), expires_at: expired }),
      ],
    });

    const response = await verifyCode(env, 'user@example.com', '12345678');
    expect(response.status).toBe(401);
    expect((await errorOf(response)).message).toBe('Invalid or expired code');
    expect(codes).toHaveLength(0); // purged on access
  });

  it('request-code purges unrelated expired rows', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString();
    const { env, codes, sent } = makeLoginEnv({
      codes: [seedCode({ email: 'stale@example.com', expires_at: expired })],
    });

    await requestCodeAndGetCode(env, 'fresh@example.com', sent);

    expect(codes.some((c) => c.email === 'stale@example.com')).toBe(false);
    expect(codes.some((c) => c.email === 'fresh@example.com')).toBe(true);
  });

  it('purgeExpiredLoginCodes removes only expired rows', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString();
    const { env, codes } = makeLoginEnv({
      codes: [
        seedCode({ email: 'dead@example.com', expires_at: expired }),
        seedCode({ email: 'alive@example.com' }),
      ],
    });

    await purgeExpiredLoginCodes(env);

    expect(codes.map((c) => c.email)).toEqual(['alive@example.com']);
  });
});

describe('email + display-name hygiene', () => {
  const EVIL_NAME = '<script>alert("pwn")</script>Evil Name';

  it('never persists or renders the requester-supplied display name', async () => {
    const { env, codes, sent, users } = makeLoginEnv();

    await requestCode(env, 'user@example.com', { display_name: EVIL_NAME });
    expect(sent).toHaveLength(1);

    // No attacker-chosen text anywhere in the email body.
    expect(sent[0].html).toBeDefined();
    expect(sent[0].text).toBeDefined();
    expect(sent[0].html!).not.toContain('Evil Name');
    expect(sent[0].html!).not.toContain('<script');
    expect(sent[0].text!).not.toContain('Evil Name');
    expect(sent[0].text!).not.toContain('<script');

    // Not persisted either: the column stays NULL.
    expect(codes[0].display_name).toBeNull();

    // And the user created on verify has no attacker-chosen name.
    const code = sent[0].text!.match(/\b\d{8}\b/)![0];
    const response = await verifyCode(env, 'user@example.com', code);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { display_name: string | null };
    };
    expect(body.user.display_name).toBeNull();
    expect(users[0].display_name).toBeNull();
  });

  it('strips display_name at the validation layer (unknown fields ignored)', () => {
    const parsed = parseBody(loginRequestSchema, {
      email: 'user@example.com',
      display_name: EVIL_NAME,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect('display_name' in parsed.data).toBe(false);
      expect(parsed.data.email).toBe('user@example.com');
    }
  });

  it('returns 502 when the EMAIL binding is missing (code never emailed)', async () => {
    const { env } = makeLoginEnv({ withEmail: false });

    const response = await requestCode(env, 'user@example.com');
    expect(response.status).toBe(502);
    expect((await errorOf(response)).message).toBe(
      'Could not send the login email'
    );
  });
});
