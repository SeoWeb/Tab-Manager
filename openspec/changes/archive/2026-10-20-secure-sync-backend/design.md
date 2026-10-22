## Context

The sync engine (`backend/src/lib/sync/`) applies client mutations through `applyMutation` → statement builders → D1 batch. Authorization today happens only at the route level (`requireProjectAccess` checks the *caller's* membership of the *route's* project); the mutation engine itself trusts entity IDs. Quota enforcement uses `env.DB.batch([guard, ...dependents])` and checks `results[0].meta.changes` *after* the batch — but D1 batches execute every statement unconditionally, so dependents commit even when the guard no-ops. Versions are read in one round-trip and incremented unconditionally in another. Login codes and rate-limiter windows have check-then-act races. Tests run on hand-rolled D1 mocks (plain Node vitest) that don't model FK constraints or batch semantics, which is why the quota bug is invisible to CI.

## Goals / Non-Goals

**Goals:**
- Make project scoping, conflict detection, idempotency, and quota commits enforced by SQL semantics rather than application discipline.
- Close the realtime revocation gap and make rate-limit windows durable.
- Give clients an honest error contract and per-mutation outcomes.
- Keep the change deployable incrementally (each section ships green).

**Non-Goals:**
- Rewriting the sync protocol or the LWW reconcile engine (client-side conflict handling is the `fix-cross-context-data-loss` change).
- Fixing migration 0003's *content* — but this change rewrites it as migration 0004-style additive steps where touching the same tables (see Migration Plan).
- Performance work beyond what correctness requires (batching/indexes are the `scale-sync-backend` change).
- New auth mechanisms (JWT lifecycle is `harden-auth-tokens`).

## Decisions

- **Project scoping via a `projectId` parameter on every statement builder.** `entityExists(entityType, id, projectId)`, `getEntityVersion(..., projectId)`, and every `prepareUpdate*`/delete gain `AND project_id = ?`. Updates additionally never set `project_id` (drop that column from the UPDATE set-list — today's code *moves* entities). *Alternative:* a trigger/DB-level constraint — rejected: D1 triggers on JSON-wide tables add opacity; explicit scoping is testable and diffable.
- **`baseVersion` becomes mandatory for updates.** The parser rejects update mutations lacking it (`400`-class per-mutation outcome). The bundled extension always sends it, so the client change is a no-op; third-party clients get an honest rejection instead of silent overwrite. *Alternative:* keep optional and treat missing as version 0 — rejected: that silently conflicts every legacy entity, worse than an explicit error.
- **CAS inside the same batch:** the version read moves into the apply batch as `SELECT version ... WHERE id = ? AND project_id = ?`, then `UPDATE ... SET version = version + 1 WHERE id = ? AND project_id = ? AND version = ?`; zero `meta.changes` on the CAS ⇒ conflict outcome. Because D1 batch statements run sequentially within one call, read-then-conditional-write in one batch closes the interleaving window for the practical purposes here (D1 serializes batch statements on the primary). *Alternative:* full serial transactions — D1 has no interactive transactions; batch-sequential is the strongest primitive available.
- **Two-phase quota commits.** Replace `batch([guard, ...dependents])` with: batch 1 = guard insert/update; inspect `meta.changes`; if 0 ⇒ `403` (no dependents run); if >0 ⇒ batch 2 = dependents. Cost: one extra round-trip on the guarded paths (project create, invitation accept, entity creates) — acceptable at their frequency. For entity creates under partial capacity, apply creates one guard per create within capacity (parallel `Promise.all` of small batches, as the existing code already does for existence checks). *Alternative:* `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < cap` single-statement guards — elegant but 5 entity types × fan-out makes the SQL sprawling; two-phase is legible.
- **Idempotency via UNIQUE index** on `(project_id, client_mutation_id)` in `sync_changes`; pre-migration de-dupes keep the earliest row. Application catches the constraint error and maps to "already applied". *Alternative:* SELECT-then-insert with a lock — no locks in D1; the index is the only real guarantee.
- **Realtime revocation via membership version.** `project_members` rows get the existing `updated_at`; on remove/role-change, `membership.ts` posts to the project's `ProjectRoom` DO (same binding `/notify` path) with `{ type: 'members-changed' }`; the DO re-checks membership per socket (it already has a D1 binding path for presence tags) and closes sockets whose user no longer has access or whose role tag is stale. *Alternative:* short-lived socket tokens forcing reconnect — rejected: disrupts all members to punish one.
- **Rate-limiter durability:** append timestamps to DO storage per key (`storage.put(key, timestamps)` with the alarm clearing drained keys); in-memory array remains the read cache. Write amplification is one small JSON put per request — fine at current traffic; revisit with a counter-based approximation if the DO ever becomes hot.
- **Error contract:** `applyMutation`/`mutations` catch blocks distinguish: known data-conflict conditions (explicitly thrown/thrown-with-code) ⇒ conflict entry; everything else ⇒ rethrow to the top-level handler, which returns `500 { error, retryable: true }` and logs internals. Conflict messages become fixed strings (`"Version conflict"`, `"Entity not found in project"`).
- **Validation:** one `lib/validation.ts` with zod schemas per endpoint body (project create/update, invitation create/accept, login request/verify, sync payload); handlers parse before logic. `expiresInDays` schema: `coerce.number().int().min(1).max(30)`.

## Risks / Trade-offs

- [Extra round-trips on guarded paths raise latency] → Guarded paths are low-frequency (project/invite/entity-create caps); `scale-sync-backend` recovers the budget on hot paths.
- [Stricter update validation surfaces previously silent client bugs] → Per-mutation `skipped`/error outcomes tell the client exactly what happened; extension is updated in the same release train.
- [CAS read inside batch still allows cross-batch races with concurrent *creates*] → Creates don't conflict on version (they insert); residual race is limited to delete-vs-update, where the CAS fails closed to a conflict — safe direction.
- [DO storage persistence increases DO storage ops] → Current traffic is small-team scale; monitor DO metrics after deploy.
- [Login codes now hashed — invalidates rows stored plaintext] → Migration deletes outstanding codes (users re-request; codes are 10-minute-lived, impact negligible).

## Migration Plan

1. Ship validation + error contract (no protocol break).
2. Ship project scoping + mandatory `baseVersion` + per-mutation outcomes in one deploy (protocol-tightening; bundled extension already compatible).
3. Run the de-dupe migration, then add the UNIQUE index; flip idempotency handling.
4. Switch quota paths to two-phase commits; update quota tests to a D1-faithful mock (miniflare) in the same PR.
5. Deploy revocation + rate-limiter durability.
6. Rewrite migration 0003's rebuild as a *new* forward migration (0004) that achieves the same schema via column drops/copies where possible — executed only after a verified backup snapshot; delete the chained-script versions.

Rollback: steps 1, 4, 5 revert by redeploy; step 2 is forward-only by design (clients rely on honest rejections); step 3's index removal is a single migration.

## Open Questions

- Should `skipped` outcomes for project-mismatched mutations be surfaced in the extension UI, or logged only? (Default: log + status counter; UI surfacing if telemetry shows it matters.)
- Exact retention for purged plaintext login-code rows: hard-delete at migration time (chosen) vs. grace period.
