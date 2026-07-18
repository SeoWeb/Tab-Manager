## Context

The backend-hardening change introduced rate limiting (via a `RateLimiter` Durable Object), usage quotas, abuse protection, and security headers. Review of the uncommitted diff found four defects that block safe deployment:

- `backend/src/db/migrations/0003_drop_e2e.sql` drops E2E-encryption columns unconditionally. On any database where the original `0003_e2e_keys` migration was never applied (or was only partially applied), those columns do not exist and `ALTER TABLE ... DROP COLUMN` errors. Because `0003` is appended to the `migrate:local`/`migrate:remote` npm scripts, the failure aborts the entire migration batch, so no subsequent migration can ever run on those DBs.
- `backend/src/lib/quotas.ts` enforces limits with a read-then-write (TOCTOU) pattern: it `COUNT(*)`s current usage, decides allowance, then a separate `INSERT`/`UPDATE` commits. Two concurrent requests can both observe `count < limit` and both proceed, overshooting the cap. This undermines the abuse boundary the quotas exist to provide.
- `backend/src/lib/ratelimit.ts` `RateLimiter.alarm()` only empties the in-memory `timestamps` array. The Durable Object instance itself (and its storage) persists for every distinct rate-limit key, leaking state indefinitely.
- The hardening diff contains formatting drift (`projects.ts` misaligned ternary, inconsistent `Response.json` wrapping) that was never passed through the formatter.

All four are implementation/quality fixes; they do not change any external API, error code, header, or default threshold.

## Goals / Non-Goals

**Goals:**
- Make `0003_drop_e2e.sql` idempotent so migrations succeed on any DB state.
- Make quota enforcement atomic (concurrency-safe) without changing error shapes.
- Reclaim idle `RateLimiter` DO instances via storage deletion.
- Land the backend code through the formatter/linter cleanly.

**Non-Goals:**
- Changing rate-limit thresholds, quota defaults, or the `429`/`403`/`400` contract.
- Adding new quota types or rate-limit tiers.
- Rewriting the `RateLimiter` storage model (e.g. to SQLite-backed) — out of scope.
- Adding end-to-end/integration tests for the migration (covered by manual `wrangler d1` verification).

## Decisions

### 1. Idempotent column drops via conditional SQL
D1/SQLite does not support `DROP COLUMN IF EXISTS`. The portable approach is a `SELECT` against `pragma_table_info` (or `pragma_table_xinfo`) to test for column existence and conditionally issue the `DROP COLUMN`. Wrapped as a no-op when absent. `DROP TABLE IF EXISTS project_keys` remains unconditional (always safe).

**Alternative considered:** Maintain a `schema_migrations`-style table and skip `0003` entirely on already-migrated DBs. Rejected — it adds bookkeeping the project does not use and still leaves the script fragile if a partial `0003` left some columns. Conditional DDL is self-correcting on every run.

### 2. Atomic quota enforcement with D1 transactions
Wrap the `COUNT` check and the committing write in a single `env.D1_DATABASE.batch(...)` / transaction so the read and write are serialized against concurrent transactions. Re-validate the count inside the transaction immediately before the write (or rely on the transactional snapshot) so overshoot is impossible. Fall back to the existing `403`/`400` responses with identical messages.

**Alternative considered:** Add a `CHECK` constraint or a trigger. Rejected — D1's limited `CHECK`/trigger support and the composite entity count (5 tables) make a constraint impractical; a transaction is the smallest correct change.

### 3. Reclaim idle RateLimiter instances
In `alarm()`, after pruning stale timestamps, if the window is fully drained call `this.ctx.storage.deleteAll()` (or delete the specific state keys) so the DO instance is garbage-collected rather than lingering with empty state. The next request re-initializes from an empty store.

**Alternative considered:** Never delete and rely on Cloudflare's own eviction. Rejected — eviction is not guaranteed and the comment explicitly promises "idle keys don't pin memory"; honoring that promise is correct.

### 4. Formatting/lint pass
Run the project's formatter (Prettier/Biome per `package.json`) over the touched backend files and commit the normalized diff.

## Risks / Trade-offs

- **[Risk]** Conditional `DROP COLUMN` SQL differs slightly between `wrangler d1 execute` (remote SQLite) and local. → Mitigation: use `pragma_table_info`, which is supported by both D1 and local SQLite; validate by running `migrate:local` on a fresh DB and a DB that already had `0003_e2e_keys` applied.
- **[Risk]** Transactional quota checks add a small amount of latency per create/invite. → Mitigation: batches are tiny (one read + one write); negligible.
- **[Risk]** Deleting `RateLimiter` storage on `alarm()` could race a concurrent request that just recorded a timestamp. → Mitigation: `alarm()` only deletes when `timestamps` is empty after pruning, which only happens when no in-window requests remain; the DO serializes requests, so a concurrent in-flight request would have already been counted.
- **[Risk]** Formatter changes may surface unrelated whitespace diffs if run repo-wide. → Mitigation: scope the formatter to the specific backend files touched by the hardening change.

## Migration Plan

1. Rewrite `0003_drop_e2e.sql` with conditional column drops.
2. Run `npm run migrate:local` on a fresh dev DB (columns absent) — must succeed.
3. Run `npm run migrate:local` on a DB where `0003_e2e_keys` was applied (columns present) — must succeed and drop the columns.
4. Deploy the Worker; run `npm run migrate:remote` on production (idempotent either way).
5. Rollback: the quota/ratelimit fixes are backward-compatible; the migration is safe to re-run. No data loss (only drops abandoned E2E columns / frees DO storage).

## Open Questions

- None outstanding. All four fixes are well-scoped and the approach is validated against D1's capabilities.
