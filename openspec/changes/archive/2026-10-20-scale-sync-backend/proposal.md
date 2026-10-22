## Why

The sync endpoint applies update/delete mutations strictly serially at ~5–6 D1 round-trips each, so a maximum-size sync (200 mutations, the cap) issues ~1,000+ sequential D1 calls — at/above the Workers 1000-subrequest ceiling and far above free-tier limits — taking seconds of serial latency. Hot-path queries lack indexes (`project_id` is unindexed on all five entity tables; every guarded create runs a 5-table `COUNT(*)`; `project_members(user_id)` has no usable index), the `sync_changes` log grows unboundedly while every mutation stores a full payload, `/snapshot` returns unbounded payloads, and realtime fan-out sends whole sync payloads to every socket including hibernating ones, awaited in the request path.

## What Changes

- Batch and parallelize mutation application: group independent mutations into D1 batches, targeting an order-of-magnitude round-trip reduction for large syncs; move realtime notification off the request path (`ctx.waitUntil`).
- Add the missing indexes: `project_id` on collections/links/tasks/notes/todos, `project_members(user_id)`, `invitations(project_id)`; replace the per-create 5-table `COUNT(*)` with cached per-request counts.
- Prune the change log: time- and count-based retention per project (default: 90 days or 50k rows/project, whichever trims first), executed via the existing DO/alarm scheduling.
- Paginate `/snapshot` (cursor by entity type/`updated_at` window) and guard realtime fan-out payload size by chunking large notifications; skip explicitly hibernating sockets when possible.

## Capabilities

### New Capabilities
- `sync-performance`: Resource budgets for the sync path — bounded D1 round-trips per sync via batching/parallelism, request-path exclusion of realtime notification, indexed hot-path queries, and paginated snapshots.
- `change-log-retention`: Time- and count-based pruning of `sync_changes` per project that preserves correctness for lagging clients via the snapshot endpoint.

### Modified Capabilities
<!-- None: existing rate-limit, quota, and authorization requirements are unchanged; performance work must not alter observable sync semantics beyond response time. -->

## Impact

- **Modified files**: `backend/src/lib/sync/sync.ts` (batched application, waitUntil notify), `sync/queries.ts` (cached counts), `sync/statements/*.ts` (batch-shaped statements), `snapshot.ts` (pagination), `realtime.ts` (chunked fan-out), new `lib/changelogPruning.ts`; `backend/wrangler.toml` (cron/alarm trigger for pruning if not DO-alarm based).
- **New migrations**: index creation on five entity tables + `project_members(user_id)` + `invitations(project_id)`. Index creation on large tables is online in D1 but should be applied off-peak.
- **Client compatibility**: snapshot pagination requires the bundled extension to follow cursors (shipped with this change); older clients keep working because the first page is a complete response for projects under the page cap.
- **Semantics preserved**: mutation outcomes, conflict detection, and quotas behave identically — only round-trip counts and payloads change.
