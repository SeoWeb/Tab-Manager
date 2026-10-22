import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  evaluateWindow,
  getRateLimitConfig,
  RateLimiter,
  type RateDecision,
} from '../ratelimit';
import { rateLimited } from '../response';
import type { Env } from '../../types';

function makeEnv(overrides: Record<string, string> = {}): Env {
  return overrides as unknown as Env;
}

describe('evaluateWindow', () => {
  const windowMs = 60_000;

  it('allows when under the limit and reports remaining = limit - count', () => {
    const now = 1_000_000;
    const decision = evaluateWindow(now, [now - 10_000, now - 20_000], 5, windowMs);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(3); // 5 - 2
    expect(decision.retryAfter).toBe(0);
  });

  it('denies at the limit and computes retryAfter from the oldest entry', () => {
    const now = 1_000_000;
    const oldest = now - 40_000;
    const decision = evaluateWindow(
      now,
      [oldest, now - 10_000, now - 20_000, now - 30_000, now - 35_000],
      5,
      windowMs
    );
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    // Oldest exits the window 20s from now (40s elapsed of a 60s window).
    expect(decision.retryAfter).toBe(20);
  });

  it('prunes timestamps older than the window before counting', () => {
    const now = 1_000_000;
    const stale = now - windowMs - 5_000;
    const decision = evaluateWindow(now, [stale, now - 1_000], 2, windowMs);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1); // only the fresh entry counts
  });

  it('treats an empty window as fully allowed', () => {
    const now = 1_000_000;
    const decision = evaluateWindow(now, [], 10, windowMs);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(10);
    expect(decision.resetAt).toBe(now + windowMs);
  });
});

describe('getRateLimitConfig', () => {
  it('uses documented defaults when no overrides are set', () => {
    const config = getRateLimitConfig(makeEnv());
    expect(config.globalPerIp.limit).toBe(120);
    expect(config.apiPerUser.limit).toBe(300);
    expect(config.syncPerUser.limit).toBe(60);
    expect(config.authRequest.limit).toBe(10);
    expect(config.authVerify.limit).toBe(20);
    for (const tier of Object.values(config)) {
      expect(tier.windowMs).toBe(60_000);
    }
  });

  it('applies valid numeric overrides', () => {
    const config = getRateLimitConfig(
      makeEnv({ RATE_LIMIT_GLOBAL_PER_IP: '250', RATE_LIMIT_SYNC_PER_USER: '5' })
    );
    expect(config.globalPerIp.limit).toBe(250);
    expect(config.syncPerUser.limit).toBe(5);
    // Untouched tiers keep their defaults.
    expect(config.apiPerUser.limit).toBe(300);
  });

  it('falls back to defaults for invalid (non-positive / non-numeric) overrides', () => {
    const config = getRateLimitConfig(
      makeEnv({ RATE_LIMIT_API_PER_USER: '0', RATE_LIMIT_AUTH_REQUEST: 'abc' })
    );
    expect(config.apiPerUser.limit).toBe(300);
    expect(config.authRequest.limit).toBe(10);
  });
});

describe('RateLimiter.alarm storage reclamation', () => {
  function makeRateLimiter(
    timestamps: number[],
    now: number
  ): { limiter: RateLimiter; deleted: { value: boolean } } {
    const deleted = { value: false };
    const storage = {
      deleteAll: async () => {
        deleted.value = true;
      },
    };
    const ctx = {
      storage: {
        deleteAll: storage.deleteAll,
        setAlarm: async () => {},
        getAlarm: async () => null,
      },
    };
    const env = {} as Env;
    const limiter = new RateLimiter(ctx as unknown as DurableObjectState, env);
    // Seed the in-memory timestamps (private) for the test clock.
    (limiter as unknown as { timestamps: number[] }).timestamps = timestamps;
    (limiter as unknown as { windowMs: number }).windowMs = 60_000;
    // Freeze Date.now() to a fixed instant.
    vi.spyOn(Date, 'now').mockReturnValue(now);
    return { limiter, deleted };
  }

  it('deletes stored state when the window has fully drained', async () => {
    const now = 1_000_000;
    const { limiter, deleted } = makeRateLimiter([now - 70_000], now);
    await limiter.alarm();
    expect(deleted.value).toBe(true);
  });

  it('keeps stored state when in-window timestamps remain', async () => {
    const now = 1_000_000;
    const { limiter, deleted } = makeRateLimiter([now - 10_000], now);
    await limiter.alarm();
    expect(deleted.value).toBe(false);
  });
});

describe('RateLimiter storage persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** In-memory stand-in for DurableObjectStorage (get/put/deleteAll). */
  function makeDurableStorage() {
    const data = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string) => data.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        data.set(key, value);
      }),
      deleteAll: vi.fn(async () => {
        data.clear();
      }),
      setAlarm: vi.fn(async () => {}),
      getAlarm: vi.fn(async () => null),
    };
    return { data, storage };
  }

  function makeLimiter(storage: unknown): RateLimiter {
    const ctx = { storage };
    return new RateLimiter(ctx as unknown as DurableObjectState, {} as Env);
  }

  async function check(
    limiter: RateLimiter,
    limit: number,
    windowMs = 60_000
  ): Promise<RateDecision> {
    const response = await limiter.fetch(
      new Request('https://ratelimit.local/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit, windowMs }),
      })
    );
    return (await response.json()) as RateDecision;
  }

  it('persists each recorded request write-through to storage', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { data, storage } = makeDurableStorage();
    const limiter = makeLimiter(storage);

    await check(limiter, 5);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(data.get('timestamps')).toEqual([1_000_000]);

    clock.mockReturnValue(1_000_500);
    await check(limiter, 5);
    expect(data.get('timestamps')).toEqual([1_000_000, 1_000_500]);
  });

  it('counts pre-restart requests against a fresh DO instance (same storage)', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { storage } = makeDurableStorage();

    const before = makeLimiter(storage);
    expect((await check(before, 3)).allowed).toBe(true);
    expect((await check(before, 3)).allowed).toBe(true);
    expect((await check(before, 3)).allowed).toBe(true);
    expect((await check(before, 3)).allowed).toBe(false); // cap reached

    // Eviction/restart: brand-new instance (empty memory), same storage.
    const after = makeLimiter(storage);
    const denied = await check(after, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);

    // Once the window drains, the restarted instance allows again.
    clock.mockReturnValue(1_000_000 + 60_001);
    expect((await check(after, 3)).allowed).toBe(true);
  });

  it('keeps a brute-force budget across a restart', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { storage } = makeDurableStorage();
    const windowMs = 60_000;

    // Three attempts hit the limiter before the DO is evicted...
    const before = makeLimiter(storage);
    for (let i = 0; i < 3; i++) {
      expect((await check(before, 5, windowMs)).allowed).toBe(true);
    }

    // ...after the restart two more succeed and the 6th is denied: the budget
    // spans the restart instead of resetting.
    const after = makeLimiter(storage);
    expect((await check(after, 5, windowMs)).allowed).toBe(true);
    expect((await check(after, 5, windowMs)).allowed).toBe(true);
    const denied = await check(after, 5, windowMs);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('deletes persisted state for a drained key when the alarm runs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { data, storage } = makeDurableStorage();

    const limiter = makeLimiter(storage);
    await check(limiter, 3);
    expect(data.has('timestamps')).toBe(true);

    // Window fully drains, alarm fires → persisted timestamps are reclaimed
    // and the instance is garbage-collectable again.
    clock.mockReturnValue(1_000_000 + 60_001);
    await limiter.alarm();
    expect(data.size).toBe(0);

    // A restarted instance starts from a clean slate (nothing resurrected).
    clock.mockReturnValue(1_000_000 + 60_002);
    const fresh = makeLimiter(storage);
    const decision = await check(fresh, 3);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(3); // nothing resurrected: empty window
  });
});

describe('rateLimited', () => {
  it('returns a 429 with Retry-After and X-RateLimit-* headers', () => {
    const decision: RateDecision = {
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1_700_000_000_000,
      retryAfter: 20,
    };
    const response = rateLimited(decision.retryAfter, decision);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBe(
      String(Math.floor(decision.resetAt / 1000))
    );
  });
});
