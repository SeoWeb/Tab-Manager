# Performance Optimizations - Page Load Lag Fix

## Problem

The application was experiencing approximately 1 second lag during page reload, causing poor user experience.

## Root Causes Identified

1. **Synchronous Chrome API calls during initialization**
2. **Heavy bookmark sync operations blocking the main thread**
3. **Multiple async operations running sequentially instead of being deferred**
4. **Complex state hydration with extensive error handling**
5. **Tab monitoring setup with immediate data fetching**
6. **Long timeout periods in store wrapper (2 seconds)**

## Optimizations Implemented

### 1. Store Wrapper Optimizations (`src/stores/storeWrapper.tsx`)

- **Reduced timeout from 2000ms to 500ms** for faster fallback
- **Added immediate store check** with quick retry mechanism
- **Improved store access pattern** with better error handling

### 2. App Store Hydration (`src/stores/appStore.ts`)

- **Replaced setTimeout with requestAnimationFrame** for better performance
- **Optimized theme application** during hydration

### 3. Bookmark Storage Initialization (`src/lib/bookmarkStorage.ts`)

- **Deferred bookmark sync operations** to avoid blocking initialization
- **Made sync operations asynchronous** with 500ms delay
- **Separated critical initialization from sync operations**

### 4. Chrome Tabs Monitoring (`src/hooks/useChromeTabsMonitoring.ts`)

- **Prioritized event listener setup** over initial data loading
- **Deferred initial Chrome windows fetch** by 300ms
- **Made tab monitoring non-blocking**

### 5. Tab Session Service (`src/lib/tabSessionService.ts`)

- **Deferred initial auto-save** by 1000ms
- **Improved debouncing** for tab change events (increased from 1s to 2s)
- **Better cleanup handling** for timeouts

### 6. App Client Optimizations (`src/components/AppClient.tsx`)

- **Used performance utilities** for better resource management
- **Implemented lazy loading** for heavy modules
- **Deferred non-critical operations** using `deferUntilIdle`
- **Added resource preloading** for commonly used modules

### 7. Performance Utilities (`src/lib/performanceUtils.ts`)

- **Created `deferUntilIdle`** function using `requestIdleCallback`
- **Implemented lazy import caching** to avoid duplicate loads
- **Added debounce and throttle utilities**
- **Created performance measurement tools**

### 8. Performance Monitoring (`src/components/PerformanceMonitor.tsx`)

- **Added real-time performance tracking**
- **Monitors page load times and hydration**
- **Provides console feedback on performance metrics**

## Expected Performance Improvements

### Before Optimizations:

- Page reload lag: ~1000ms
- Blocking operations during startup
- Sequential loading of heavy modules
- Long timeout periods

### After Optimizations:

- **Target page reload time: <500ms**
- **Non-blocking initialization**
- **Deferred heavy operations**
- **Faster fallback mechanisms**
- **Lazy loading of modules**

## Key Performance Strategies Used

1. **Deferral**: Move non-critical operations to idle time
2. **Lazy Loading**: Load modules only when needed
3. **Caching**: Cache imported modules to avoid re-loading
4. **Debouncing**: Reduce frequency of expensive operations
5. **Prioritization**: Load critical UI components first
6. **Async Operations**: Make blocking operations asynchronous

## Monitoring

The `PerformanceMonitor` component now tracks:

- Page load time
- DOM content loaded time
- Total load time
- React hydration time

Check browser console for performance metrics after page load.

## Testing

To verify the improvements:

1. Open browser developer tools
2. Go to Network tab and enable "Disable cache"
3. Reload the page multiple times
4. Check console for performance metrics
5. Observe the reduced lag time

## Future Optimizations

If further performance improvements are needed:

1. **Code splitting**: Split large components into smaller chunks
2. **Service Worker**: Cache resources for faster subsequent loads
3. **Preloading**: Preload critical resources during idle time
4. **Bundle analysis**: Identify and optimize large dependencies
5. **Memory optimization**: Reduce memory usage during initialization

---

# Part 2: Backend Sync Performance (scale-sync-backend) — Measured Baseline

Everything above concerns extension page load. This part documents the measured
performance envelope of the Cloudflare Workers sync backend (`backend/`),
delivered with the `scale-sync-backend` OpenSpec change (tasks 6.1 + 6.2).
Every number below comes from an actual executed run — the `measure:load`
runner output is pasted verbatim at the end of this section, and the local D1
seed was applied and verified with real `wrangler d1 execute --local` queries.

## Measurement basis (read first)

- **Round-trip / statement counts are exact.** They are counted D1 calls
  (one `batch()` call = one round-trip, matching D1's API) made by the real
  production modules (`syncProject`, `getProjectSnapshot`,
  `runChangelogPruning`) against the in-repo D1 mock
  (`backend/src/lib/__tests__/cases/harness.ts`) plus two exact-statement-shape
  shims for the snapshot and pruning SQL.
- **Wall times are harness-simulated (in-memory) and indicative only.** They
  contain no network latency and no D1 query planning. Because each serial
  round-trip costs ~1 network RTT in production, real-world wall-time gains
  from batching should be *larger* than the in-memory ratios shown here.
- **The local wrangler D1 database (`tab-manager-dev`, `--local`) is really
  seeded** (5,000 links / 50 collections / 50,000 `sync_changes` verified by
  COUNT, and the migration-0006 pruning index verified by `EXPLAIN QUERY
  PLAN`). A live round-trip measurement through `wrangler dev` was not
  practical for this pass; the harness numbers above are the deliverable for
  round-trips/subrequests.

## Summary

| # | Scenario | Serial / unbounded | Batched / paginated | Budget | Verdict |
|---|----------|--------------------|---------------------|--------|---------|
| 1 | 200-mutation independent-update sync — D1 round-trips | 723 (400 batches + 323 solo) | **21** (18 batches + 3 solo) | ≤ 100 excl. quota reads (spec) | **PASS** — 0 quota reads in run |
| 1 | 200-mutation sync — wall time (indicative) | 204 ms | 15 ms | — | — |
| 2 | 50-mutation sync — D1 round-trips | 183 (100 + 83) | **8** (5 batches + 3 solo) | 50 subrequests/request (free tier) | **PASS** — 8 D1 + 1 DO notify = 9 of 50 (headroom 41) |
| 3 | Snapshot, 5,000 links + 50 collections — statements | 5 (legacy unbounded read) | **14** (10 page calls @ 500) | ≤ 500 rows/type/response | **PASS** — identical row set, bounded payloads |
| 4 | Changelog pruning, 50,000 rows / 120 days — statements | — | pass 1: 39, pass 2: 20 | 40 statements/run | **PASS (budget-bound by design)** — 12,501 rows cleared in 2 nightly runs |

## 1. Maximum-size sync (200 mutations) — spec budget ≤ 100 round-trips

Measured **21 round-trips** batched (3 solo reads: project membership,
`MAX(sync_changes.id)` fan-out cursor, post-apply delta read; plus 18 batched
statements groups). The same sync through the `SYNC_SERIAL_MODE=1` kill-switch
(pre-batching engine) costs **723 round-trips** — over the 100 budget by 7x,
and over the free-tier 50-subrequest cap by 14x. All 200 outcomes report
`applied` in both modes; outcome/state equivalence is pinned by the vitest
suite (`syncBatchEquivalence.test.ts`).

## 2. 50-mutation sync vs the free-tier 50-subrequest cap

Ledger for the measured batched run:

| Component | Count |
|-----------|-------|
| D1 round-trips (5 batches + 3 solo reads) | 8 |
| Quota-guard reads (0 creates in request; with creates: 1 cached read per request) | 0 |
| ProjectRoom DO notification (`ctx.waitUntil`, off the request path, issues no D1 statements) | 1 |
| **Total** | **9 of 50 → headroom 41** |

Production note: the route middleware additionally performs 1 RateLimiter DO
fetch per sync request (`applyRateLimiting`), bringing a real request to
**10 of 50 (headroom 40)** — still a wide pass. The serial mode for
comparison: 183 D1 round-trips alone — over the cap.

## 3. Snapshot of a 5,000-link project

- Legacy unbounded read: **5 statements** (one per entity type) returning all
  5,050 rows in a single response — statement count was never the problem;
  unbounded payload size/memory was.
- Paginated (`SNAPSHOT_PAGE_SIZE=500`): **14 statements** across 10 page calls
  (page 1 reads all 5 types; 9 link continuation pages), each response ≤ 500
  rows per type. The iterated paginated fetch returned the **identical row
  set** (50 collections + 5,000 links), satisfying "paginated reconcile equals
  full snapshot".

## 4. Changelog pruning pass (default env)

Dataset: 50,000 `sync_changes` rows spread over ~120 days; defaults
(`CHANGELOG_RETENTION_DAYS=90`, `CHANGELOG_MAX_ROWS_PER_PROJECT=50000`,
`CHANGELOG_PRUNE_BATCH_ROWS=500`, `CHANGELOG_PRUNE_MAX_STATEMENTS=40`) make
12,501 rows prunable (retention window; the 50k cap is not binding).

- **Pass 1: 39 of 40 statements spent, 9,000 rows deleted**, then the statement
  budget is exhausted and the project is deferred (logged) — by design, so a
  backlog cannot monopolize a cron run.
- **Pass 2 (next night): 20 statements, 3,501 rows** — done; the pruning
  horizon (`project_sync_meta`, migration 0007) updates after each pass.
- Subrequest behavior: every statement is one D1 query; a run is capped at 40
  statements — under the free-tier 50-subrequest cap and far under the paid
  1,000. Steady state (~420 inserts/day against a 90-day window) prunes in
  ~5 statements/run; only a fresh large backlog needs multiple nights.

## Methodology

**Modeled by the harness:** per-statement `meta.changes`, D1 batch atomicity
(a throwing statement rolls back the batch), `UNIQUE(project_id,
client_mutation_id)` replay rejection (migration 0004), FK constraints,
version-guard CAS predicates (`AND (SELECT version ...) = ?`), quota-guard
`INSERT ... SELECT ... WHERE count < limit` semantics, and per-statement
results inside batches — the same mock the backend vitest suites run on.

**Not modeled:** network latency and RTT accumulation (see basis note), D1
query planning/index behavior — the snapshot/pruning shims serve rows from
arrays using the production statement shapes, so counts match what D1 would
receive, but index usage was verified separately on the seeded local D1
(`EXPLAIN QUERY PLAN` → `SCAN sync_changes USING COVERING INDEX
idx_sync_changes_project_created_at`); worker CPU limits; DO internals
(notification is counted as 1 subrequest).

**Reproduce:**

```sh
# one-time: local schema (migrations 0001..0007)
npm --prefix backend run migrate:local
# seed local D1 (~8.5 MB SQL, 605 batched INSERTs, repeatable)
npm --prefix backend run seed:load
# measurement suite (deterministic; prints the table below)
npm --prefix backend run measure:load
```

Prerequisites for the numbers to hold: migrations **0006** (hot-path indexes,
incl. `idx_sync_changes_project_created_at` used by pruning) and **0007**
(`project_sync_meta`, the horizon bookkeeping pruning writes) must be applied.

## Ops notes

- **Rollback:** `SYNC_SERIAL_MODE=1` reverts to the per-mutation serial engine.
  Warning: at 200 mutations that is 723 round-trips — over both the free-tier
  subrequest cap and the spec budget; treat as an emergency correctness switch
  only.
- **`SNAPSHOT_PAGE_SIZE`** (default 500, clamped 1..2000): server-side page
  cap; a request's `pageSize` may lower it, never raise it.
- **Pruning env vars:** `CHANGELOG_RETENTION_DAYS` (90), `CHANGELOG_MAX_ROWS_PER_PROJECT`
  (50000), `CHANGELOG_PRUNE_BATCH_ROWS` (500), `CHANGELOG_PRUNE_MAX_STATEMENTS`
  (40), `CHANGELOG_PRUNE_DRY_RUN=1` (read-only estimate).
- **Cron:** `[triggers] crons = ["0 3 * * *", "30 3 * * *"]` in
  `backend/wrangler.toml` — login-code purge at 03:00, changelog pruning at
  03:30 UTC. Pause pruning by removing the cron trigger; the backlog then
  clears over multiple nights once re-enabled (measured: ~12.5k rows/night at
  50k/120-day shape).

## Verbatim runner output (`npm --prefix backend run measure:load`)

```text
==============================================================================
Load measurement suite — harness-simulated (in-memory D1 mock, deterministic)
Round-trip / statement counts are EXACT (counted D1 calls; one batch = one round-trip).
Wall times are in-memory and INDICATIVE only (no network, no D1 planner).
==============================================================================

[1] Sync: 200 independent updates (spec budget <= 100 excl. quota reads)
    serial  :  723 round-trips (400 batches + 323 solo, quota reads 0)  204 ms
    batched :   21 round-trips (18 batches + 3 solo, quota reads 0)  15 ms
    verdict : PASS (21 <= 100; quota reads in run: 0; outcomes all applied: 200/200)

[2] Sync: 50 independent updates (Workers free tier: 50 subrequests/request)
    serial  :  183 round-trips (100 batches + 83 solo)  16 ms
    batched :    8 round-trips (5 batches + 3 solo)  2 ms
    budget  : 8 D1 + 0 quota reads + 1 DO notify (waitUntil) = 9 of 50
    verdict : PASS (headroom 41 subrequest(s))

[3] Snapshot read: 5,000 links + 50 collections (page cap 500)
    legacy unbounded :   5 statements (1 per type)  1 ms  rows: 5050
    paginated @500   :  14 statements (10 page calls)  3 ms  rows: 5050
    verdict : paginated iteration returns the identical row set (per-type counts match); statements 5 -> 14 (+9)

[4] Changelog pruning: 50,000 rows over 120 days (retention 90d, cap 50,000, batch 500, budget 40 stmts)
[changelog-prune] {"projectId":"p-load","dryRun":false,"timeBasedRows":9000,"countBasedRows":0,"maxPrunedChangeId":9000,"horizonCreatedAt":"2026-07-14T09:03:24.873Z","metaDeleted":false,"statementsUsed":39}
[changelog-prune] run complete {"dryRun":false,"retentionCutoff":"2026-07-22T18:39:33.903Z","candidates":1,"projectsPruned":1,"rowsPruned":9000,"statementsUsed":39,"budgetExhausted":true,"remainingProjects":1}
[changelog-prune] statement budget (40) exhausted; deferring 1 project(s) to the next run: p-load
    pass 1  :  39 statements,   9000 rows deleted (time 9000 / cap 0), budgetExhausted=true, deferred 1, 599 ms
[changelog-prune] {"projectId":"p-load","dryRun":false,"timeBasedRows":3501,"countBasedRows":0,"maxPrunedChangeId":12501,"horizonCreatedAt":"2026-07-22T18:42:29.233Z","metaDeleted":false,"statementsUsed":20}
[changelog-prune] run complete {"dryRun":false,"retentionCutoff":"2026-07-22T18:39:34.502Z","candidates":1,"projectsPruned":1,"rowsPruned":3501,"statementsUsed":20,"budgetExhausted":false,"remainingProjects":0}
    pass 2  :  20 statements,   3501 rows deleted (time 3501 / cap 0), budgetExhausted=false, deferred 0, 193 ms
    verdict : 12501 rows pruned over 2 nightly runs, 59 statements total; the per-run statement budget (40) keeps each run inside the cron window and bounds subrequests via CHANGELOG_PRUNE_MAX_STATEMENTS

==============================================================================
All scenarios measured. Counts are exact for the modeled D1 surface.
==============================================================================
```

Local D1 seed verification (`wrangler d1 execute tab-manager-dev --local`):

```text
seed_links: 5000, seed_collections: 50, seed_versions: 5050,
seed_changes: 50000, distinct_days: 121, older_than_90d: 12176

EXPLAIN QUERY PLAN (pruning candidate scan):
SCAN sync_changes USING COVERING INDEX idx_sync_changes_project_created_at
```

---

# Part 3: Bundle & Dependency Cleanup (cleanup-and-regression-tests) — Measured

This part records the dependency cleanup, the calendar rework and the
dead-code removal delivered with the `cleanup-and-regression-tests` OpenSpec
change. Every number below comes from an actual executed gate run on the
final tree; the "before" numbers are the baseline captured before any
cleanup task ran. Both sides use the identical byte-counting method.

## Measurement method

Raw shippable asset bytes are the uncompressed size of every `.js`/`.css`
file in the production export (`build/`):

```sh
find build/ \( -name "*.js" -o -name "*.css" \) | xargs stat -c%s | awk '{s+=$1} END {print s}'
```

Directory size is `du -sk build/`. No compression is applied; this is what
ships to the Chrome Web Store (packaged) and what the extension loads.

## Gate run on the final tree — all green

| Gate | Result |
|------|--------|
| `pnpm run lint` (`eslint .`) | clean — 0 problems |
| `pnpm run typecheck` (`tsc --noEmit`) | clean |
| `pnpm test` (jest, extension) | **438 passed / 438**, 69/69 suites |
| `pnpm run test:backend` (backend tsc + vitest) | **414 passed + 2 expected-fails** (416 total), 31/31 files |
| `pnpm run build` (lint + typecheck + `next build` + background bundle + post-build) | green |
| `pnpm --prefix frontend run build` | green |

The 2 backend expected-fails are deliberate `it.fails` tripwires in
`backend/src/lib/__tests__/integration/concurrency.test.ts` pinning two known
invitation-race bugs: (1) the loser of two concurrent accepts surfaces a raw
D1 UNIQUE-constraint error (500-class) instead of a structured outcome, and
(2) two users racing one login code both commit a membership. They exist so
the eventual `acceptInvitation` fix cannot land silently — flipping them to
plain `it` is part of that fix, not part of this cleanup.

## Dependencies

Removed from the root `package.json` (all six verified absent by grep):

- `firebase`
- `cheerio`
- `fs-extra`
- `moment`
- `react-big-calendar`
- `@types/react-big-calendar`

Added: `@tabspace/shared` (workspace dep, `packages/shared`) and
`eslint-plugin-jsx-a11y` (devDep, backs the a11y lint gate).

| Package.json | Before | After (at gate time) |
|---|---|---|
| root `dependencies` | 49 | 45 |
| root `devDependencies` | 26 | 26 |
| `frontend/package.json` | (pre-trim) | 4 deps / 12 devDeps — web-specific only; runtime deps for the tree reused from `src/` come from the root workspace |

Note: the root measures 45/26 rather than the 44/25 landing target because
task 3.4 (adding `backend` to the pnpm workspace and rewiring the root
scripts) was still in flight when these gates ran; the six removal targets
above are gone regardless of that residual.

## Calendar rework (react-big-calendar + moment → react-day-picker)

`TaskCalendarView` was reworked on `react-day-picker` (+`date-fns`) and the
legacy rbc/moment path deleted. Proof from the shipped bundle:

- `grep -rlE "react-big-calendar|rbc-calendar|rbc-time" build/` → **0 files**
- `grep -rli "rbc-" build/` → **0 files** (no rbc CSS selectors either)
- `grep -rlE "momentjs|moment\.min|moment\.locale|moment-locales" build/`
  and `grep -rl "function moment(" build/` → **0 files** each
- `react-day-picker` is present (chunk `762.*.js`)

CSS is now a **single** stylesheet,
`build/next/static/css/ad8557494e0d98f5.css` at **72,899 B**; the standalone
rbc CSS chunk measured mid-change (~**14.4 KB**) is merged away with the
library gone.

## Dead code removed

- `src/components/MainLayout/` deleted — **0** `MainLayout` references in
  `build/`.
- `scripts/update-favicons.js` deleted (one-off migration tool).
- Debug routes `/debug-favicons` and `/favicon-migration` are gated behind
  `INCLUDE_DEBUG_ROUTES=1`: the production export contains exactly 3 routes
  (`/`, `/_not-found`, `/icon.png`) and **0** files matching
  `*debug*`/`*favicon-migration*`. The web frontend intentionally keeps
  `/favicon-migration` and `/privacy` as web-only routes.

## Bundle size — before / after

| Metric | Before (baseline) | After (final tree) | Δ |
|---|---|---|---|
| Raw `.js`+`.css` bytes in `build/` | 2,818,475 | **2,236,393** (56 files: 55 js + 1 css) | **−582,082 B (−20.6%)** |
| `build/` on disk | 3.2 MB | **2.9 MB** (2,956 KiB) | ≈ −250 KiB |

Largest chunks after cleanup (`find build/ -name '*.js' | xargs stat -c%s |
sort -rn | head -8`):

| File | Bytes |
|---|---|
| `next/static/chunks/487.*.js` | 416,111 |
| `next/static/chunks/40-*.js` | 175,664 |
| `next/static/chunks/64d558e9-*.js` | 168,415 |
| `background.js` (MV3 service worker, esbuild) | 165,326 |
| `next/static/chunks/894.*.js` | 145,148 |
| `next/static/chunks/framework-*.js` | 139,861 |
| `next/static/chunks/343-*.js` | 121,437 |
| `next/static/chunks/main-*.js` | 119,639 |

`next build` route table: `/` 1.4 kB page / 147 kB first-load JS; shared by
all routes 103 kB.

## Test-count caveat (test-only growth, not shipped)

The gate numbers grew because this change also delivered the regression
suite: jest went **355 → 438** tests and the backend suite **300 → 414 (+2
tripwires)**. This is test-only growth — none of it is in the production
export measured above.

## Reproduce

```sh
pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:backend && pnpm run build
find build/ \( -name "*.js" -o -name "*.css" \) | xargs stat -c%s | awk '{s+=$1} END {print s}'
du -sk build/
find build/ -name '*.js' | xargs stat -c'%s %n' | sort -rn | head -8
grep -rlE "react-big-calendar|rbc-|moment-locales" build/ | wc -l   # expect 0
```
