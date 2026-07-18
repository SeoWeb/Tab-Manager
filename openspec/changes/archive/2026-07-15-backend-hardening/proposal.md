## Why

The Cloudflare backend has no general API rate limiting, no request-body size limit, no cap on sync mutations per request, and no usage quotas (max projects/members/entities per user or project). The only abuse control today is per-email throttling inside the magic-PIN login flow. This leaves the API open to brute-force, resource-exhaustion, and unbounded-growth abuse. We need defense-in-depth at the edge before promoting the backend beyond local/dev use.

## What Changes

- Add a `RateLimiter` Durable Object implementing a precise sliding-window counter, one instance per rate-limit key (authoritative in-memory state).
- Apply tiered rate limits at the `fetch` entrypoint: a global per-IP limit plus endpoint-specific limits for authenticated API, sync, and the two auth routes.
- On rate-limit breach, return `429` with `Retry-After` and `X-RateLimit-*` headers; on success, attach `X-RateLimit-*` headers to the response.
- Enforce usage quotas: max projects per user, max members per project, max entities per project, and max sync mutations per request. Quota breaches return `403` with a structured error.
- Add abuse protection: a request-body size guard (`413`) on all JSON endpoints (including auth), and standard security response headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- All thresholds and quotas are configurable via optional env vars with sensible defaults.

## Capabilities

### New Capabilities
- `api-rate-limiting`: Backend-enforced rate limiting via a `RateLimiter` Durable Object — tiered limits (global per-IP, authenticated API per-user, sync per-user, auth request-code/verify per-IP), `429` responses with `Retry-After` + `X-RateLimit-*` headers, and env-configurable thresholds.
- `usage-quotas`: Backend-enforced resource quotas — max projects per user, max members per project, max entities per project, max sync mutations per request — returning `403` on breach, with env-configurable limits.
- `abuse-protection`: Request-body size limit (`413`) on all JSON endpoints, shared validation helper, and baseline security response headers on every response.

### Modified Capabilities
<!-- No existing spec-level requirements change; all three capabilities are new. -->

## Impact

- **New files**: `backend/src/lib/ratelimit.ts`, `backend/src/lib/quotas.ts`, plus their unit tests.
- **Modified files**: `backend/src/index.ts` (rate-limit middleware + header attachment, `RateLimiter` re-export), `backend/src/lib/response.ts` (429/403/413 helpers), `backend/src/lib/cors.ts` (security headers), `backend/src/lib/auth.ts` and `backend/src/index.ts` `readJson` (body-size guard), `backend/src/lib/projects.ts` (project + member quotas), `backend/src/lib/sync.ts` (sync mutation cap + entity quota), `backend/src/types.ts` (new `Env` binding + optional config props), `backend/wrangler.toml` (`RATE_LIMITER` binding + migration entry), `backend/.dev.vars.example` (documented overrides).
- **Dependencies**: Adds a new Durable Object class (registers on next `wrangler deploy`); no new D1 migration table is required (counters live in the DO).
- **API contract**: New `429`/`403`/`413` responses and `X-RateLimit-*` / security headers; existing success/error shapes otherwise unchanged.
