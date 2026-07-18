## Why

The backend-hardening change (rate limiting, usage quotas, abuse protection, security headers) shipped as uncommitted work, but review surfaced four concrete defects that must be fixed before it is committed and deployed:

1. **Migration `0003_drop_e2e.sql` breaks on common DB states.** It unconditionally runs `ALTER TABLE ... DROP COLUMN` for columns that may not exist (e.g. databases where the abandoned `0003_e2e_keys` migration was never applied). `wrangler d1 execute` does not skip errors, so `migrate:local`/`migrate:remote` fail outright on those DBs — blocking all future migrations.
2. **Usage-quota checks are racy (TOCTOU).** `checkProjectQuota` / `checkMemberQuota` / `checkEntityQuotaForMutations` do a `COUNT(*)` then a later `INSERT`/`UPDATE` with no transaction or guard. Concurrent requests can both pass and overshoot the limit, defeating the abuse boundary.
3. **`RateLimiter` Durable Object instances are never freed.** `alarm()` only empties the in-memory array; the DO instance itself persists, leaking storage for every distinct rate-limit key forever.
4. **Formatting/lint drift** introduced in the hardening diff (misaligned ternary in `projects.ts`, inconsistent `Response.json` wrapping) was never run through the formatter.

## What Changes

- **Make `0003_drop_e2e.sql` safe to re-run on any DB state.** Guard each `DROP COLUMN` so it only executes when the column exists, and keep `DROP TABLE IF EXISTS project_keys` unconditional. This lets `migrate:local`/`migrate:remote` succeed whether or not the E2E columns were ever present.
- **Make quota enforcement atomic.** Perform the count-then-create/invite inside a D1 transaction (or re-validate the count after the write) so concurrent requests cannot overshoot the configured maximum. Behavior and error shapes (`403` / `400`) are unchanged.
- **Actually release idle `RateLimiter` instances.** On `alarm()`, when the window has fully drained, delete the instance's stored state (`storage.deleteAll()`) so it is reclaimed instead of lingering.
- **Run the formatter/linter over the touched backend files** so the diff is clean and consistent.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `usage-quotas`: Quota checks must be concurrency-safe (atomic count-then-write); the requirement that limits are enforced is unchanged but the enforcement mechanism gains a correctness guarantee.
- `api-rate-limiting`: The `RateLimiter` Durable Object must release its instance storage once idle, in addition to the existing sliding-window semantics.

## Impact

- **Migrations**: `backend/src/db/migrations/0003_drop_e2e.sql` (rewritten to be idempotent), `backend/package.json` migrate scripts (unchanged, but now succeed).
- **Backend libs**: `backend/src/lib/quotas.ts` (transactional/atomic quota enforcement), `backend/src/lib/ratelimit.ts` (`alarm()` storage reclamation).
- **Tooling**: Formatter/linter run over `backend/src/lib/projects.ts`, `backend/src/lib/ratelimit.ts`, `backend/src/lib/quotas.ts`, `backend/src/lib/response.ts`.
- **Specs**: Delta specs for `usage-quotas` and `api-rate-limiting`.
- **No API/contract changes** — error codes, headers, and defaults are preserved.
