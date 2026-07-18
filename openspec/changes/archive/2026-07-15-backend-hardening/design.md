## Context

The backend is a Cloudflare Worker (`backend/src/index.ts`) backed by D1 and one Durable Object (`ProjectRoom` in `lib/realtime.ts`) for realtime presence. Today the only abuse control is per-email throttling inside `requestLoginCode` (D1-backed). There is no general rate limiting on API routes, no request-body size limit, no cap on sync mutations per request, and no resource quotas. Auth is a magic-PIN flow (`lib/auth.ts`) issuing JWTs; request bodies are parsed with `readJson`, which does not bound size.

We add three defense-in-depth capabilities: rate limiting (Durable Object), usage quotas (D1 counts), and abuse protection (body-size guard + security headers). The existing D1-first style and the `ProjectRoom` Durable Object pattern are the templates we follow.

## Goals / Non-Goals

**Goals:**
- Precise, per-key rate limiting with minimal per-request overhead.
- Tiered limits appropriate to each route's cost (global, authenticated API, sync, auth).
- Enforce resource quotas so a single user/project cannot exhaust shared storage.
- Block oversized and malformed request bodies and set baseline security headers.
- Make every threshold tunable via env vars with safe defaults.

**Non-Goals:**
- Billing-grade usage metering or per-customer plan tiers (this is throttling + caps, not invoicing).
- IP reputation / bot scoring / WAF rules (handled by Cloudflare separately).
- Per-endpoint custom quotas beyond the tiered set defined here.
- Changing the success/error shape of existing successful responses.

## Decisions

### D1. Rate limiter = dedicated `RateLimiter` Durable Object (sliding window)
Each rate-limit key (e.g. `rl:global:ip:1.2.3.4`) maps via `env.RATE_LIMITER.idFromName(key)` to exactly one DO instance, so its in-memory state is authoritative and consistent. The instance keeps a `number[]` of request timestamps; `evaluateWindow(now, timestamps, limit, windowMs)` prunes entries older than `windowMs`, allows when `length < limit`, and computes `remaining` / `resetAt` (oldest + window) / `retryAfter` (seconds). This is precise (true sliding window, not fixed buckets) and adds only one co-located subrequest per request.

*Alternative considered:* D1 fixed-window counters — simpler but eventual consistency across regions can both over- and under-count, and adds a write per request. *Chosen:* DO for accuracy; D1 not needed for counters (no migration).

*Alternative considered:* Workers KV — not used anywhere else in the repo and reads are eventually consistent. Rejected.

### D2. Rate-limited at the `fetch` entrypoint, before routing
In `index.ts`, skip `OPTIONS` (preflight has no body/cost). Then: (1) global per-IP limit; (2) a tier selected from URL segments + authentication. User-keyed tiers decode the subject cheaply via `verifyJwt` (no D1 lookup) so the rate-limit key is stable without the DB cost of `requireUser`. Breaches return `withCors`-wrapped `429`. Allowed decisions' `X-RateLimit-*` headers are attached to the final response after `route()`.

Tiers (all windows = 60s, all overridable):
| Tier | Key | Default |
|---|---|---|
| Global | `rl:global:ip:<ip>` | 120/min |
| Authenticated API | `rl:api:user:<sub>` (fallback `rl:api:ip:<ip>`) | 300/min |
| Sync | `rl:sync:user:<sub>` (fallback `rl:sync:ip:<ip>`) | 60/min |
| Auth request-code | `rl:auth:request:ip:<ip>` | 10/min |
| Auth verify | `rl:auth:verify:ip:<ip>` | 20/min |

### D3. Quotas enforced in the domain handlers, returning `403`
`lib/quotas.ts` exposes `getQuotaConfig(env)` + checkers that return `null` or a `403` `Response`:
- `checkProjectQuota(env, userId)` — `COUNT(*) FROM projects WHERE owner_id = ? AND deleted_at IS NULL` ≥ `QUOTA_MAX_PROJECTS_PER_USER` (default 10).
- `checkMemberQuota(env, projectId)` — `COUNT(*) FROM project_members` ≥ `QUOTA_MAX_MEMBERS_PER_PROJECT` (default 50).
- `checkEntityQuotaForMutations(env, projectId, createCount)` — sum of rows across `collections/links/tasks/notes/todos` for the project, compared to current + pending creates ≥ `QUOTA_MAX_ENTITIES_PER_PROJECT` (default 5000).
- `checkSyncMutationsPerRequest(count, cfg)` — returns `400` `badRequest` (abuse, not a provisioned quota) when `count > QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST` (default 200).

Applied in `createProject`, `createInvitation`, `acceptInvitation`, and `syncProject`. Quota breaches use `403` (distinct from `429` rate limiting, per chosen reporting).

### D4. Abuse protection: shared body-size guard + security headers
A shared `readJson(request, { maxBytes })` (default 1 MB) checks `Content-Length` then reads and bounds the body, returning `413` `payloadTooLarge` when exceeded. `readJson` in `index.ts` and the JSON parsing in `lib/auth.ts` both route through it. `lib/cors.ts`'s `withCors` also sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.

### D5. Config via optional env var overrides
`Env` gains `RATE_LIMITER: DurableObjectNamespace` and optional string props for every threshold. `getRateLimitConfig` / `getQuotaConfig` parse with `Number.parseInt` fallbacks to defaults, so deployments need not set anything to get safe behavior. Documented in `.dev.vars.example`.

## Risks / Trade-offs

- [Risk] One DO instance per distinct key → many idle instances (e.g. one per IP). → Mitigation: each instance holds only `≤ limit` timestamps; lazy pruning + an `alarm()` that clears empty instances keeps memory tiny; idle instances hibernate for free.
- [Risk] DO instance for a key is lost/restarted → window resets (more permissive briefly). → Mitigation: acceptable for throttle/abuse defense; not billing. Global per-IP cap still bounds worst case.
- [Risk] Local `wrangler dev` has no `CF-Connecting-IP`, so all traffic shares the `unknown` bucket. → Mitigation: still rate-limits; documented; production path uses the real header.
- [Risk] Entity quota check adds a `UNION ALL` count per sync with creates. → Mitigation: computed once per request, not per mutation; 5000-entity cap keeps it bounded.
- [Risk] New DO class must be registered before it works. → Mitigation: `wrangler.toml` adds the binding + a `[[migrations]]` entry; verified by `wrangler deploy` / `wrangler dev`.

## Migration Plan

1. Add `RATE_LIMITER` DO binding and `[[migrations]]` (`new_classes = ["RateLimiter"]`) to `wrangler.toml`.
2. `npm --prefix backend run typecheck && npm --prefix backend run test` (unit tests for pure logic + helpers).
3. `wrangler dev` smoke test: loop a route → confirm `429` + headers; create 11th project → confirm `403`; oversized body → confirm `413`.
4. Deploy via `wrangler deploy` (registers the new DO class).
5. Rollback: revert the deploy; the code is additive and the DO class can be left registered without harm. No D1 schema change, so no data migration/rollback needed.

## Open Questions

- None blocking. Whether to surface remaining-quota in a future usage endpoint is deferred.
