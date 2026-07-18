import { describe, it, expect, vi } from 'vitest';
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
