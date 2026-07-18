import { rateLimited } from './response';
import type { Env } from '../types';

/**
 * The decision returned by a rate-limit check: whether the request is allowed,
 * plus the values needed to populate the `X-RateLimit-*` / `Retry-After`
 * response headers.
 */
export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the oldest in-window request exits the window. */
  resetAt: number;
  /** Seconds the caller must wait before retrying (0 when allowed). */
  retryAfter: number;
}

/**
 * Pure sliding-window evaluator. Prunes timestamps older than `windowMs`, then
 * decides allowance against `limit`.
 *
 * - `remaining` is reported *before* this request is recorded, so a caller that
 *   is allowed still sees one slot "left" for a follow-up (matches the spec's
 *   `remaining = limit - count`).
 * - `retryAfter` is seconds until the oldest in-window request expires.
 */
export function evaluateWindow(
  now: number,
  timestamps: number[],
  limit: number,
  windowMs: number
): RateDecision {
  const cutoff = now - windowMs;
  const valid = timestamps.filter((t) => t > cutoff);
  const count = valid.length;
  const allowed = count < limit;
  const remaining = allowed ? limit - count : 0;
  const oldest = valid[0];
  const resetAt = oldest ? oldest + windowMs : now + windowMs;
  const retryAfter = allowed
    ? 0
    : Math.max(1, Math.ceil((resetAt - now) / 1000));
  return { allowed, limit, remaining, resetAt, retryAfter };
}

/**
 * `RateLimiter` Durable Object — one instance per rate-limit key (the key is
 * turned into the instance id by the caller via `idFromName`). It keeps an
 * in-memory `number[]` of request timestamps; the window is precise (true
 * sliding window, not fixed buckets). An `alarm()` clears empty instances so
 * idle keys don't pin memory.
 *
 * A lost/restarted instance resets the window (more permissive briefly); that
 * is an accepted trade-off for throttle-grade defense, and the global per-IP
 * cap still bounds the worst case.
 */
export class RateLimiter implements DurableObject {
  private timestamps: number[] = [];
  private windowMs = 60_000;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload: { limit?: unknown; windowMs?: unknown };
    try {
      payload = (await request.json()) as {
        limit?: unknown;
        windowMs?: unknown;
      };
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    const limit =
      typeof payload.limit === 'number' && payload.limit > 0
        ? payload.limit
        : 60;
    const windowMs =
      typeof payload.windowMs === 'number' && payload.windowMs > 0
        ? payload.windowMs
        : 60_000;
    this.windowMs = windowMs;

    const now = Date.now();
    const decision = evaluateWindow(now, this.timestamps, limit, windowMs);

    if (decision.allowed) {
      this.timestamps.push(now);
      // Wake once the oldest timestamp is due to expire so we can prune/clear.
      const oldest = this.timestamps[0];
      const delay = Math.max(1, oldest + windowMs - Date.now());
      this.ctx.storage.setAlarm(Date.now() + delay).catch(() => {});
    }

    return Response.json(decision);
  }

  /** Clear the instance once its window has fully drained. */
  async alarm(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => t > now - this.windowMs);
    // When the window has fully drained there are no in-window timestamps, so
    // delete the stored state and let the Durable Object be reclaimed instead of
    // lingering with empty state.
    if (this.timestamps.length === 0) {
      await this.ctx.storage.deleteAll();
    }
  }
}

function parseOverride(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RateLimitTier {
  limit: number;
  windowMs: number;
}

export interface RateLimitConfig {
  globalPerIp: RateLimitTier;
  apiPerUser: RateLimitTier;
  syncPerUser: RateLimitTier;
  authRequest: RateLimitTier;
  authVerify: RateLimitTier;
}

const WINDOW_MS = 60_000;

/**
 * Resolve the tiered rate-limit thresholds from env overrides, falling back to
 * safe defaults when unset or invalid. Every tier uses a 60s window.
 */
export function getRateLimitConfig(env: Env): RateLimitConfig {
  return {
    globalPerIp: {
      limit: parseOverride(env.RATE_LIMIT_GLOBAL_PER_IP, 120),
      windowMs: WINDOW_MS,
    },
    apiPerUser: {
      limit: parseOverride(env.RATE_LIMIT_API_PER_USER, 300),
      windowMs: WINDOW_MS,
    },
    syncPerUser: {
      limit: parseOverride(env.RATE_LIMIT_SYNC_PER_USER, 60),
      windowMs: WINDOW_MS,
    },
    authRequest: {
      limit: parseOverride(env.RATE_LIMIT_AUTH_REQUEST, 10),
      windowMs: WINDOW_MS,
    },
    authVerify: {
      limit: parseOverride(env.RATE_LIMIT_AUTH_VERIFY, 20),
      windowMs: WINDOW_MS,
    },
  };
}

/**
 * Best-effort client IP: `CF-Connecting-IP` (production), then the first
 * `X-Forwarded-For` hop, then `unknown`. Local `wrangler dev` has neither, so
 * all traffic shares the `unknown` bucket (still rate-limited).
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

/**
 * Run a single key's sliding-window check against its `RateLimiter` instance.
 * Fails open (allowed) when the DO binding is absent so the backend still
 * serves traffic in test/local setups without the binding.
 */
export async function checkRateLimit(
  env: Env,
  name: string,
  limit: number,
  windowMs: number
): Promise<RateDecision> {
  if (!env.RATE_LIMITER) {
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt: Date.now() + windowMs,
      retryAfter: 0,
    };
  }

  const id = env.RATE_LIMITER.idFromName(name);
  const stub = env.RATE_LIMITER.get(id);
  const response = await stub.fetch('https://ratelimit.local/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit, windowMs }),
  });
  return (await response.json()) as RateDecision;
}

/**
 * Enforce a single key's limit. Returns the decision when allowed, or a
 * CORS-ready `429` `Response` on breach.
 */
export async function enforceRateLimit(
  env: Env,
  name: string,
  limit: number,
  windowMs: number
): Promise<RateDecision | Response> {
  const decision = await checkRateLimit(env, name, limit, windowMs);
  if (!decision.allowed) {
    return rateLimited(decision.retryAfter, decision);
  }
  return decision;
}
