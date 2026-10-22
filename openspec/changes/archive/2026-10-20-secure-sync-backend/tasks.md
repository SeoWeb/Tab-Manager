## 1. Validation & Error Contract (no protocol break)

- [x] 1.1 Add `zod` to `backend/package.json`; create `backend/src/lib/validation.ts` with schemas: projectCreate/projectUpdate (trimmed name 1–200, description ≤2000, color/icon enums/length), invitationCreate (`expiresInDays` int 1–30, default 7), loginRequest/loginVerify, syncPayload
- [x] 1.2 Wire schemas into `crud.ts`, `invitations.ts`, `login.ts`, and `sync.ts`; reject with `400` + field-level summary via a new `badRequest(details)` response helper
- [x] 1.3 Make project update trim/validate names symmetrically with create; make project deletion (HTTP and sync-driven) require owner role (not admin)
- [x] 1.4 Rework `applyMutation.ts` / `mutations.ts` catch blocks: known data-conflict conditions → conflict entry with fixed message strings; everything else → rethrow; top-level handler returns `500 { error, retryable: true }` and logs internals
- [x] 1.5 Update/extend backend tests: sanitized messages (no SQL/constraint text), 5xx+retryable on simulated D1 failure, 400 on schema violations, 403-vs-500 on owner/admin delete

## 2. Project Scoping & Mandatory baseVersion

- [x] 2.1 Add `projectId` parameter to `entityExists`, `getEntityVersion`, and every `prepareUpdate*`/delete statement builder; add `AND project_id = ?`; remove `project_id` from all UPDATE set-lists
- [x] 2.2 Reject update mutations lacking `baseVersion` with a per-mutation bad-mutation outcome; treat exists/version misses as conflict/skipped outcomes (never cross-project writes)
- [x] 2.3 Ensure changelog/version fan-out for every mutation is written to the *entity's* project; add a regression test that a rejected foreign-entity mutation writes nothing anywhere
- [x] 2.4 Add per-mutation outcome list to the sync response (`applied | conflict | skipped{reason} | error`) and stop silently `continue`-ing mismatches in `sync.ts`
- [x] 2.5 Extend the extension's sync response handler to only drop queued mutations for `applied`/resolved-`conflict`/acknowledged-`skipped`; log `error` outcomes and keep them queued
- [x] 2.6 Add IDOR regression tests (editor of project A cannot update/delete/move project B's entities; foreign version reads yield conflicts)

## 3. CAS Versions & Idempotency

- [x] 3.1 Move the version read into the apply batch; implement `UPDATE ... SET version = version + 1 WHERE id = ? AND project_id = ? AND version = ?` with 0-changes ⇒ conflict outcome
- [x] 3.2 Create migration `0004_unique_client_mutation_id.sql`: de-duplicate existing `(project_id, client_mutation_id)` rows (keep earliest) then add the UNIQUE index
- [x] 3.3 Map unique-violation on changelog insert to "already applied" success outcome; add concurrency tests (two identical submissions ⇒ one entity, one row, second answered as applied)
- [x] 3.4 Add a CAS regression test: two updates with the same `baseVersion` ⇒ exactly one applies

## 4. Atomic Quota Commits

- [x] 4.1 Rewrite `enforceCount` usage in `crud.ts` (createProject) to two-phase: guard batch → check `meta.changes` → dependents batch; return structured `403` when guard no-ops
- [x] 4.2 Same for `invitations.ts` acceptInvitation: no `accepted_at` update unless the membership guard inserted; invitation stays retryable
- [x] 4.3 Same for entity creates in `sync.ts`: per-create guard, apply only within remaining capacity, no version bumps/changelog for blocked creates, `403` for overflow
- [x] 4.4 Replace the D1 mock in `quotas.concurrent.test.ts` with a miniflare/`@cloudflare/vitest-pool-workers`-based harness (or a mock that models `meta.changes` + FK semantics) and add tests: 403-not-500, unburned invitation, no phantom changelog, partial-capacity behavior

## 5. Realtime Revocation & Rate-Limit Durability

- [x] 5.1 In `membership.ts`, post `{ type: 'members-changed' }` to the project's `ProjectRoom` DO on remove and role change
- [x] 5.2 In `realtime.ts`, handle `members-changed` by re-checking current membership/role per connected socket and closing (or downgrading) sockets whose access changed; presence role derived from live membership
- [x] 5.3 Persist sliding-window timestamps in `ratelimit.ts` to DO storage (write-through, alarm cleanup unchanged); add tests: window survives simulated restart, drained state still reclaimed
- [x] 5.4 Add test: removed editor's socket receives no further fan-out

## 6. Login-Code Hardening

- [x] 6.1 Make code verification atomic: single conditional `DELETE ... WHERE email = ? AND code_hash = ? AND expires_at > now RETURNING *` (or equivalent batch) minting a token only on a returned row
- [x] 6.2 Make attempt counting a single conditional `UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND attempts < max`; invalidate at cap
- [x] 6.3 Store codes hashed (sha-256 + per-row salt); purge expired rows on access and via the existing alarm path; fix code generation to rejection-sampling (no modulo bias)
- [x] 6.4 Stop persisting requester-supplied display names for unverified addresses; remove free-form name interpolation from the email template
- [x] 6.5 Migration to purge plaintext code rows; update login tests: concurrent-verify single token, brute-force cap across restart, hashed-at-rest, no attacker text in email

## 7. Migration 0003 Remediation

- [x] 7.1 Remediate migration 0003: evidence showed 0003 hard-fails on populated DBs (FK-enforced rollback blocks the chain — no data loss, but fatal); no E2E-polluted DB exists. Resolution: 0003 deleted from the migration set; one-time manual cleanup script `backend/scripts/drop-e2e-columns.sql` for any straggler; verified fresh apply chain 0001→0002→0004
- [x] 7.2 Delete 0003 from the pending set for existing DBs (baseline procedure from `harden-ci-and-config`); document the verified backup (`d1 export`) prerequisite in `deployment.md`
