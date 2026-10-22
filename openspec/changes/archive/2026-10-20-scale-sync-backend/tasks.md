## 1. Index Migration

- [x] 1.1 Create migration `0006_hot_path_indexes.sql` (renumbered from 0005 — taken by Phase 1): `project_id` indexes on collections, links, tasks, notes, todos; `project_members(user_id)`; `invitations(project_id)`; `sync_changes(project_id, created_at)` — one statement each, ordered smallest-table-first
- [x] 1.2 Apply locally and verify query plans (`EXPLAIN QUERY PLAN`) for: entityExists, version read, entity count, member project listing, snapshot reads — no table scans on hot paths

## 2. Request-Path Cost Reductions

- [x] 2.1 Cache the entity-quota count once per sync request in `sync.ts` (indexed COUNT + in-memory decrement per applied create); keep the two-phase guard for the boundary create
- [x] 2.2 Move `notifyRealtime` in `sync.ts` to `ctx.waitUntil` with try/catch logging; test that a throwing/slow DO doesn't affect the sync response
- [x] 2.3 Micro-audit `applyMutation` for redundant per-mutation SELECTs that batch-scoping can fold (dedupe check + version read) without semantics change

## 3. Batched Mutation Application

- [x] 3.1 Add dependency classification in `sync.ts`: independent creates / independent updates / independent deletes / dependent subgroups (same-entity chains) → serial fallback for dependents
- [x] 3.2 Implement batched create application (guarded inserts per type in one batch per type group) and batched CAS updates/deletes; map per-statement `meta` results to per-mutation outcomes
- [x] 3.3 Add `SYNC_SERIAL_MODE=1` kill-switch env to force the serial path
- [x] 3.4 Outcome-equivalence harness: seeded D1 (local wrangler) + synthetic 200-mutation sync → serial vs batched produce identical outcome lists; round-trip counter (D1 query metrics or instrumentation) ≤ 100
- [x] 3.5 Conflict-in-batch test: one CAS failure inside a batch conflicts only its mutation; unrelated mutations apply

## 4. Change-Log Pruning

- [x] 4.1 Create `backend/src/lib/changelogPruning.ts`: delete-oldest batches per project by `CHANGELOG_RETENTION_DAYS` (default 90) and `CHANGELOG_MAX_ROWS_PER_PROJECT` (default 50000), bounded rows/statement with subrequest budget
- [x] 4.2 Maintain per-project pruning horizon (`MIN(created_at)` post-prune) in a small `project_sync_meta` table (migration 0007 — renumbered from 0006, taken) for lagging-client detection
- [x] 4.3 Add `[triggers] crons` daily schedule in `wrangler.toml` routing to the pruning handler; add dry-run env for logging-only mode
- [x] 4.4 In incremental sync, compare request cursor to the horizon; respond `{ reconcileRequired: true }` when stale; verify the extension (release-train version) falls back to snapshot reconcile
- [x] 4.5 Tests: retention prune, count-cap prune, active-cursor unaffected, stale-cursor gets reconcileRequired

## 5. Snapshot Pagination & Fan-Out Chunking

- [x] 5.1 Add cursor pagination to `snapshot.ts` (opaque `(type, updated_at, id)` cursor, `SNAPSHOT_PAGE_SIZE` default 500, `nextCursor` per entity type); unknown/invalid cursor ⇒ 400 with reconcile hint
- [x] 5.2 Update the extension's snapshot fetch to iterate cursors per type and merge before diffing; keep single-page behavior when `nextCursor` is absent (old-server compatibility)
- [x] 5.3 In `realtime.ts`, chunk fan-out payloads over 512 KB into ordered `{seq, total, payload}` frames; collect sockets once; per-socket try/catch inside `waitUntil`
- [x] 5.4 Update the extension's realtime handler to reassemble chunks before applying
- [x] 5.5 Tests: 5,000-link project paginates fully; paginated reconcile equals unbounded reconcile; chunked notification reassembles; one failed socket doesn't block others

## 6. Load Validation

- [x] 6.1 Script a seeded load scenario (scripts/: 200-mutation sync, 5k-entity snapshot, 50k-row changelog) run against local wrangler D1; record round-trips, wall time, subrequest counts in `PERFORMANCE_OPTIMIZATIONS.md`
- [x] 6.2 Verify free-tier subrequest budget for a representative 50-mutation sync (≤ 50 round-trips + notification)
