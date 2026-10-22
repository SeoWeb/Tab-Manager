## Context

`sync.ts` applies mutations with a serial `for` loop calling `applyMutation` per mutation; each call performs a dedupe SELECT, version SELECT, existence SELECT, row SELECT, and an apply batch (plus move-detection SELECT for JSON entities) — 5–6 sequential round-trips each. The Workers runtime caps a request at 1000 subrequests (50 on free tier), so a 200-mutation sync is at/over the ceiling. `notifyRealtime` is `await`ed in the request path. `0001_init.sql` declares no `project_id` index on any entity table; `project_members` has only `UNIQUE (project_id, user_id)`, unusable for `user_id` lookups; `invitations` only indexes `code`. `sync_changes` has no pruning and stores full patches per mutation.

The client (`fix-cross-context-data-loss` change) is being fixed in the same release train, so pagination can require a client update — but must not break older clients outright.

## Goals / Non-Goals

**Goals:**
- 200-mutation syncs complete within platform limits with an order-of-magnitude round-trip reduction.
- Hot-path queries become index-supported; quota counting is per-request, not per-mutation.
- The change log stops growing unboundedly without breaking lagging clients.
- Snapshots and fan-out payloads become bounded.

**Non-Goals:**
- Changing conflict semantics, quota behavior, or authorization (previous change owns those).
- Streaming/websocket-based sync or delta compression (future architecture work).
- Client-side performance (virtualization/memoization already shipped via existing specs).
- Read-replica or multi-region strategies (D1 is single-region).

## Decisions

- **Group mutations into independent batches by dependency class.** Creates for distinct entities are independent → one batch of guarded inserts (per-type statement builders already exist); updates to *distinct* entities are independent → batched CAS updates sharing a pre-batch existence/version read per entity (still inside the same batch statement sequence, per the CAS decision in `secure-sync-backend`); deletes batch similarly. Ordering within a sync (client-specified sequence) is preserved by applying groups in submission order and reporting per-mutation outcomes; cross-mutation dependencies within one sync (update-then-delete of the same entity) are detected and routed to the serial path for that subgroup. *Alternative:* fully serial for correctness — that is today's behavior and the problem; the dependency-class routing keeps the serial path only where semantics require it.
- **Cache the entity-quota count per request.** Count once per sync (one indexed `COUNT`), decrement in-memory per applied create, and rely on the two-phase guard for the boundary case. *Alternative:* exact per-create guarded counts — 5 queries × N creates again.
- **Pruning via a scheduled Worker handler** (`[triggers] crons` in `wrangler.toml`, daily off-peak) rather than a DO alarm per project — one scheduled run queries prunable projects in bounded batches (e.g. 500 rows per statement, loop with subrequest budget). Env vars `CHANGELOG_RETENTION_DAYS=90`, `CHANGELOG_MAX_ROWS_PER_PROJECT=50000`. *Alternative:* DO alarms per project — thousands of alarms to manage; cron is simpler at this scale.
- **Lagging-client detection:** incremental sync compares the request cursor against the project's oldest retained `created_at` (maintained cheaply as `MIN(created_at)` per project, updated by pruning); cursor older than horizon ⇒ response `{ reconcileRequired: true }` and the client (already shipped in the release train) falls back to snapshot reconcile. *Alternative:* per-client cursor tracking tables — state we don't need.
- **Snapshot pagination:** cursor = opaque `(entityType, updated_at, id)` triple; page cap 500/type via env `SNAPSHOT_PAGE_SIZE`; response includes `nextCursor` per type. Bundled extension iterates per type and merges pages before diffing. Older clients (no cursor param) get page 1 — complete for projects under the cap; the release notes call out the update. *Alternative:* `Accept: application/json+stream` NDJSON streaming — Workers support is awkward with D1 cursors; pagination is portable.
- **Fan-out chunking:** if serialized notification JSON exceeds 512 KB, split into ordered `{ seq, total, payload }` frames; client reassembles before applying (change already grouped per sync, so chunk boundaries are safe). Fan-out collects socket set once, sends sequentially with per-socket try/catch inside `waitUntil`. *Alternative:* always send a "changes available" ping forcing clients to pull — round-trip cost per sync; chunking preserves push semantics.

## Risks / Trade-offs

- [Batched application changes failure granularity] → Per-mutation outcomes are computed from per-statement `meta` results; a failed statement marks only its mutation. Covered by the CAS/conflict tests from the security change, extended for batching.
- [Index creation on large tables locks/loads D1] → D1 index builds are online but resource-heavy; apply off-peak, one index per migration, ordered smallest-table-first.
- [Pruning deletes rows a 90-day-absent member needs] → `reconcileRequired` path handles it by design; snapshot is the correctness backstop.
- [Cron pruning runs against a growing table without an index on `created_at`] → Pruning migration adds `(project_id, created_at)` index on `sync_changes` (also serves count caps).
- [Client/server skew during rollout of pagination] → Server tolerates missing cursor (page 1) and unknown cursor (400 with reconcile hint); client tolerates absence of `nextCursor` (single-page behavior).

## Migration Plan

1. Index migration first (pure addition; immediately reduces hot-path cost even before batching).
2. Ship count caching + `waitUntil` notification (small, low-risk).
3. Ship batched application behind the existing mutation-outcome contract; load-test with a synthetic 200-mutation sync against a seeded D1 (local wrangler) verifying outcome equivalence vs. serial mode (kept temporarily behind an env kill-switch `SYNC_SERIAL_MODE=1`).
4. Ship pruning (cron + horizon detection) and the `(project_id, created_at)` index.
5. Ship snapshot pagination + fan-out chunking together with the extension update.

Rollback: kill-switch back to serial sync; pruning can pause by disabling the cron trigger; pagination is additive and ignored by old clients.

## Open Questions

- Page cap default (500 vs 1000) pending a real-world largest-project measurement.
- Whether `notifyRealtime` should dedupe fan-out when several syncs land within one notification window (batching follow-up, not required for budgets).
