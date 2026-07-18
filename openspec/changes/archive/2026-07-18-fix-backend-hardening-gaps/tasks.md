## 1. Idempotent E2E-drop migration

- [x] 1.1 Rewrite `backend/src/db/migrations/0003_drop_e2e.sql` so `DROP TABLE IF EXISTS project_keys` stays unconditional and each `ALTER TABLE ... DROP COLUMN` runs only when the column exists (use `pragma_table_info` to guard, no-op when absent).
- [x] 1.2 Verify the rewritten migration runs cleanly on a fresh local DB (columns absent) via `npm run migrate:local`.
- [x] 1.3 Verify the rewritten migration runs cleanly on a local DB where `0003_e2e_keys` was previously applied (columns present) and actually drops the four columns.

## 2. Atomic quota enforcement

- [x] 2.1 Refactor `checkProjectQuota` in `backend/src/lib/quotas.ts` to perform the count and the project `INSERT` inside a single D1 transaction/batch, re-validating capacity before commit; return the existing `403` on breach.
- [x] 2.2 Refactor `checkMemberQuota` to perform the count and the membership `INSERT` (invite and accept paths) inside a single D1 transaction; return the existing `403` on breach.
- [x] 2.3 Refactor `checkEntityQuotaForMutations` so the entity count and the create-mutation application are serialized within a transaction; return the existing `403` on breach.
- [x] 2.4 Add/adjust unit tests in `backend/src/lib/__tests__/quotas.test.ts` covering the concurrency-safety scenarios (at-most-one-wins behavior) without changing the public error shapes.

## 3. RateLimiter instance reclamation

- [x] 3.1 Update `alarm()` in `backend/src/lib/ratelimit.ts` to call `this.ctx.storage.deleteAll()` (or delete the specific state key) when `timestamps` is empty after pruning, so the DO instance is reclaimed.
- [x] 3.2 Add a unit test in `backend/src/lib/__tests__/ratelimit.test.ts` asserting that an idle instance's stored state is cleared on alarm.

## 4. Formatting / lint pass

- [x] 4.1 Run the project formatter over `backend/src/lib/projects.ts`, `backend/src/lib/ratelimit.ts`, `backend/src/lib/quotas.ts`, and `backend/src/lib/response.ts` to normalize the hardening-diff drift (misaligned ternary, `Response.json` wrapping).
- [x] 4.2 Run `npm --prefix backend run typecheck` and `npm --prefix backend run test` to confirm the backend still builds and passes.

## 5. Verification

- [x] 5.1 Run `npm run migrate:local` end-to-end and confirm it succeeds on both DB states from step 1.2/1.3.
- [x] 5.2 Run the full backend test suite and confirm `evaluateWindow`, quota, and rate-limit tests pass.
