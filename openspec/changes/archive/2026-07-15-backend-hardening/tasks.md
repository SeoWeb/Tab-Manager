## 1. Rate Limiter Durable Object

- [x] 1.1 Create `backend/src/lib/ratelimit.ts` with the `RateLimiter` Durable Object class: in-memory sliding-window `number[]` per instance, `alarm()` to clear empty instances, and a `fetch` POST handler accepting `{ limit, windowMs }`.
- [x] 1.2 Extract a pure, exported `evaluateWindow(now, timestamps, limit, windowMs)` helper returning `{ allowed, limit, remaining, resetAt, retryAfter }` and use it from the DO.
- [x] 1.3 Add `clientIp(request)` (CF-Connecting-IP → X-Forwarded-For → `unknown`), `getRateLimitConfig(env)` (defaults + env overrides), `checkRateLimit(env, name, limit, windowMs)`, and `enforceRateLimit(...)` (returns decision or `429` Response).

## 2. Response & CORS Helpers

- [x] 2.1 In `backend/src/lib/response.ts`, add `rateLimited(retryAfter, decision)`, `quotaExceeded(message)`, and `payloadTooLarge(maxBytes)` helpers.
- [x] 2.2 In `backend/src/lib/cors.ts`, have `withCors` also set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.

## 3. Quotas Module

- [x] 3.1 Create `backend/src/lib/quotas.ts` with `getQuotaConfig(env)` (defaults + env overrides) and checkers `checkProjectQuota(env, userId)`, `checkMemberQuota(env, projectId)`, `checkEntityQuotaForMutations(env, projectId, createCount)`, and `checkSyncMutationsPerRequest(count, cfg)`.

## 4. Wire Rate Limiting into the Entrypoint

- [x] 4.1 In `backend/src/types.ts`, add `RATE_LIMITER: DurableObjectNamespace` and optional env override props; re-export `RateLimiter` from `backend/src/index.ts`.
- [x] 4.2 In `backend/src/index.ts`, skip rate limiting for `OPTIONS`, enforce the global per-IP limit, then select a tier from URL segments + `verifyJwt`-decoded subject, enforce it, and return `withCors`-wrapped `429` on breach.
- [x] 4.3 Attach `X-RateLimit-Limit/-Remaining/-Reset` headers from allowed decisions to the final response after `route()`.

## 5. Wire Quotas & Abuse Protection into Handlers

- [x] 5.1 In `backend/src/lib/projects.ts`, enforce `checkProjectQuota` in `createProject` and `checkMemberQuota` in `createInvitation` + `acceptInvitation`.
- [x] 5.2 In `backend/src/lib/sync.ts`, enforce `checkSyncMutationsPerRequest` and `checkEntityQuotaForMutations` in `syncProject`.
- [x] 5.3 Add a shared `readJson(request, { maxBytes })` body-size guard (default 1 MB → `413`) used by `backend/src/index.ts` `readJson` and the JSON parsing in `backend/src/lib/auth.ts`.

## 6. Configuration & Deployment

- [x] 6.1 In `backend/wrangler.toml`, add the `RATE_LIMITER` Durable Object binding and a new `[[migrations]]` entry (`new_classes = ["RateLimiter"]`).
- [x] 6.2 Document the new env overrides in `backend/.dev.vars.example`.

## 7. Tests & Verification

- [x] 7.1 Add `backend/src/lib/__tests__/ratelimit.test.ts` covering `evaluateWindow`, config parsing, and the `rateLimited` helper.
- [x] 7.2 Add `backend/src/lib/__tests__/quotas.test.ts` covering config parsing, quota/body-size response helpers, and the sync-mutation cap.
- [x] 7.3 Run `npm --prefix backend run typecheck && npm --prefix backend run test` and confirm green; smoke-test `429`/`403`/`413` flows locally via `wrangler dev`.
