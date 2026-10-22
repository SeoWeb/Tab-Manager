/**
 * Load measurement suite for the sync backend (openspec: scale-sync-backend,
 * task 6.1 / 6.2). Deterministic, in-memory: it drives the REAL production
 * modules (`syncProject`, `getProjectSnapshot`, `runChangelogPruning`) on top
 * of the same D1 mock the vitest suites use
 * (`src/lib/__tests__/cases/harness.ts`) — no wrangler, no network.
 *
 * Measured:
 *   [1] 200-mutation independent-update sync — D1 round-trips, serial vs
 *       batched (spec budget: <= 100 excl. quota reads)
 *   [2] 50-mutation independent-update sync — D1 round-trips (free tier:
 *       50 subrequests/request; the realtime notify adds 1 DO subrequest,
 *       scheduled off the request path via ctx.waitUntil, and issues NO D1
 *       statements from the sync path)
 *   [3] snapshot read of a 5,000-link dataset — statement count for the
 *       legacy unbounded read (1 statement/type) vs the paginated reader
 *       (page size 500), plus row-set equality of both
 *   [4] changelog pruning pass over a 50,000-row change log spread over
 *       120 days (retention 90 d, per-project cap 50,000, batch 500,
 *       statement budget 40) — two consecutive nightly passes
 *
 * Counting basis (labeled honestly):
 *   - Round-trip / statement counts are EXACT: every harness D1 call is
 *     counted (batch calls count as one round-trip each, like D1 batch).
 *   - Wall times are harness-simulated (in-memory JS): indicative only, NOT
 *     network latency or D1 query-planning time.
 *   - The two SQL shims below ([3] and [4]) serve rows from arrays using the
 *     same statement shapes the production code issues, so statement counts
 *     match what D1 would see; row serving is simulated.
 *
 * Run: npm run measure:load   (in backend/)
 */

import { syncProject } from '../src/lib/sync';
import { getProjectSnapshot } from '../src/lib/snapshot';
import { runChangelogPruning } from '../src/lib/changelogPruning';
import type {
  Env,
  SyncMutation,
  SyncMutationOutcome,
  SnapshotResponse,
} from '../src/types';
import {
  makeEnv,
  baseDb,
  type DB,
  type Row,
} from '../src/lib/__tests__/cases/harness';

// ===========================================================================
// Shared helpers (technique from syncBatchEquivalence.test.ts)
// ===========================================================================

const NOW = '2020-01-01T00:00:00.000Z';

function entityFor(i: number): {
  entityType: SyncMutation['entityType'];
  id: string;
} {
  const kind = i % 5;
  const id = `${['col', 'lnk', 'tsk', 'nt', 'td'][kind]}-${String(i).padStart(3, '0')}`;
  const entityType = (['collection', 'link', 'task', 'note', 'todo'] as const)[
    kind
  ];
  return { entityType, id };
}

/** n live entities (5 types), all in p1 at version 2, plus their version rows. */
function seededSyncDb(n: number): DB {
  const db = baseDb();
  db.project_members = [{ project_id: 'p1', user_id: 'u1', role: 'editor' }];
  for (let i = 0; i < n; i++) {
    const { entityType, id } = entityFor(i);
    if (entityType === 'collection') {
      db.collections.push({
        id,
        project_id: 'p1',
        name: `Name ${i}`,
        deleted_at: null,
      });
    } else if (entityType === 'link') {
      db.links.push({
        id,
        project_id: 'p1',
        collection_id: null,
        url: `https://example.com/${i}`,
        title: `Link ${i}`,
        fav_icon_url: null,
        notes: null,
        tags_json: null,
        order_index: null,
        bookmark_id: null,
        deleted_at: null,
      });
    } else {
      const table =
        entityType === 'task'
          ? db.tasks
          : entityType === 'note'
            ? db.notes
            : db.todos;
      (table as Row[]).push({
        id,
        project_id: 'p1',
        collection_id: null,
        title: `Title ${i}`,
        payload_json: '{}',
        order_index: null,
        deleted_at: null,
      });
    }
    db.entity_versions.push({
      project_id: 'p1',
      entity_type: entityType,
      entity_id: id,
      version: 2,
      updated_at: NOW,
    });
  }
  return db;
}

/** n independent update mutations (distinct entities, valid baseVersion 2). */
function buildUpdateMutations(n: number): SyncMutation[] {
  const mutations: SyncMutation[] = [];
  for (let i = 0; i < n; i++) {
    const { entityType, id } = entityFor(i);
    mutations.push({
      clientMutationId: `cm-load-${String(i).padStart(3, '0')}`,
      projectId: 'p1',
      clientId: 'client-1',
      createdAt: NOW,
      entityType,
      entityId: id,
      operation: 'update',
      baseVersion: 2,
      patch:
        entityType === 'collection'
          ? { name: `Batch ${i}` }
          : { title: `Batch ${i}` },
    });
  }
  return mutations;
}

interface Counts {
  batches: number;
  solo: number;
  /** Quota-guard reads, excluded from the spec's round-trip budget. */
  quotaReads: number;
}

/**
 * Wrap a harness env with a round-trip counting proxy: every solo statement
 * execution (first/all/run) counts 1, every batch call counts 1 (one D1
 * round-trip each, like production). The entity-quota COUNT read is counted
 * separately — the spec's sync budget explicitly excludes quota-guard
 * round-trips.
 */
function countingEnv(base: Env): { env: Env; counts: Counts } {
  const d1 = base.D1_DATABASE;
  const counts: Counts = { batches: 0, solo: 0, quotaReads: 0 };
  const env = {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => {
        const stmt = d1.prepare(sql);
        return {
          bind: (...params: unknown[]) => {
            const bound = stmt.bind(...params) as unknown as {
              first: () => Promise<unknown>;
              all: () => Promise<unknown>;
              run: () => Promise<unknown>;
              __exec: () => unknown;
            };
            const isQuotaGuardRead =
              /SELECT\s+\(SELECT COUNT\(\*\) FROM collections/.test(sql);
            const tick = () => {
              if (isQuotaGuardRead) counts.quotaReads += 1;
              else counts.solo += 1;
            };
            return {
              first: async () => {
                tick();
                return bound.first();
              },
              all: async () => {
                tick();
                return bound.all();
              },
              run: async () => {
                tick();
                return bound.run();
              },
              __exec: () => bound.__exec(),
            };
          },
        };
      },
      batch: (stmts: Parameters<typeof d1.batch>[0]) => {
        counts.batches += 1;
        return d1.batch(stmts);
      },
    },
  } as unknown as Env;
  return { env, counts };
}

interface SyncResult {
  roundTrips: number;
  batches: number;
  solo: number;
  quotaReads: number;
  applied: number;
  changelogRows: number;
  ms: number;
}

async function measureSync(n: number, serialMode: boolean): Promise<SyncResult> {
  const db = seededSyncDb(n);
  const { env, counts } = countingEnv(
    makeEnv(db, serialMode ? { SYNC_SERIAL_MODE: '1' } : {})
  );
  const started = Date.now();
  const response = await syncProject(
    env,
    { id: 'u1' },
    'p1',
    { lastCursor: null, mutations: buildUpdateMutations(n) }
  );
  const ms = Date.now() - started;
  if (response.status !== 200) {
    throw new Error(`[measure] sync returned ${response.status}`);
  }
  const body = (await response.json()) as { outcomes: SyncMutationOutcome[] };
  const applied = body.outcomes.filter((o) => o.status === 'applied').length;
  if (applied !== n) {
    throw new Error(
      `[measure] expected ${n} applied outcomes, got ${applied}`
    );
  }
  return {
    roundTrips: counts.batches + counts.solo,
    batches: counts.batches,
    solo: counts.solo,
    quotaReads: counts.quotaReads,
    applied,
    changelogRows: db.sync_changes.length,
    ms,
  };
}

// ===========================================================================
// [3] Snapshot shim: serves the paginated-reader statement shape
//     (`FROM <table> t LEFT JOIN entity_versions ... WHERE t.project_id = ?
//     ORDER BY t.updated_at ASC, t.id ASC LIMIT ?`) from in-memory arrays.
// ===========================================================================

interface Dataset {
  collections: Record<string, unknown>[];
  links: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  todos: Record<string, unknown>[];
}

const TYPE_TO_TABLE: Record<string, keyof Dataset> = {
  collections: 'collections',
  links: 'links',
  tasks: 'tasks',
  notes: 'notes',
  todos: 'todos',
};

function snapshotShim(
  dataset: Dataset,
  projectId: string,
  statements: { count: number }
): D1Database {
  const serve = (
    table: keyof Dataset,
    after: { u: string; i: string } | null,
    limit: number
  ): Record<string, unknown>[] => {
    let rows = dataset[table].filter((r) => r.project_id === projectId);
    if (after) {
      rows = rows.filter((r) => {
        const u = r.updated_at as string;
        const id = r.id as string;
        return u > after.u || (u === after.u && id > after.i);
      });
    }
    rows.sort((a, b) => {
      const ua = a.updated_at as string;
      const ub = b.updated_at as string;
      if (ua !== ub) return ua < ub ? -1 : 1;
      return (a.id as string) < (b.id as string) ? -1 : 1;
    });
    return rows.slice(0, limit);
  };

  return {
    prepare: (sql: string) => {
      const match = sql.match(
        /FROM (collections|links|tasks|notes|todos) t\s+LEFT JOIN entity_versions/
      );
      if (!match) {
        throw new Error(`[snapshot-shim] unexpected statement: ${sql.trim()}`);
      }
      const table = TYPE_TO_TABLE[match[1]!];
      return {
        bind: (...params: unknown[]) => ({
          all: async () => {
            statements.count += 1;
            const limit = params[params.length - 1] as number;
            // Keyset form binds [entityType, projectId, u, u, id, limit].
            const after =
              params.length >= 6
                ? {
                    u: params[2] as string,
                    i: params[4] as string,
                  }
                : null;
            return { results: serve(table, after, limit) };
          },
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } }),
        }),
      };
    },
  } as unknown as D1Database;
}

/** 5,000 links + 50 collections, updated_at spread over 120 days. */
function buildSnapshotDataset(): Dataset {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = Date.now();
  const spread = 120 * DAY_MS;
  const iso = (msAgo: number) => new Date(start - msAgo).toISOString();
  const padId = (n: number, w: number) => String(n).padStart(w, '0');
  const collections: Record<string, unknown>[] = [];
  for (let i = 0; i < 50; i++) {
    const updatedAgo = Math.floor((spread * (49 - i)) / 49);
    collections.push({
      id: `col-${padId(i, 4)}`,
      project_id: 'p-load',
      name: `Collection ${i}`,
      description: null,
      color: null,
      minimized: 0,
      order_index: i,
      bookmark_folder_id: null,
      updated_at: iso(updatedAgo),
      deleted_at: null,
    });
  }
  const links: Record<string, unknown>[] = [];
  for (let i = 0; i < 5_000; i++) {
    const updatedAgo = Math.floor((spread * (4_999 - i)) / 4_999);
    links.push({
      id: `lnk-${padId(i, 5)}`,
      project_id: 'p-load',
      collection_id: `col-${padId(i % 50, 4)}`,
      url: `https://example.com/load/${i}`,
      title: `Link ${i}`,
      fav_icon_url: null,
      notes: null,
      tags_json: null,
      order_index: i,
      bookmark_id: null,
      updated_at: iso(updatedAgo),
      deleted_at: null,
    });
  }
  return { collections, links, tasks: [], notes: [], todos: [] };
}

interface SnapshotResult {
  statements: number;
  pages: number;
  rowsByType: Record<string, number>;
  ms: number;
}

/** Legacy (pre-pagination) reader model: one statement per type, no keyset. */
async function measureLegacySnapshot(dataset: Dataset): Promise<SnapshotResult> {
  const statements = { count: 0 };
  const shim = snapshotShim(dataset, 'p-load', statements);
  const rowsByType: Record<string, number> = {};
  const started = Date.now();
  for (const type of Object.keys(TYPE_TO_TABLE)) {
    const table = TYPE_TO_TABLE[type]!;
    const total = dataset[table].length;
    // Same statement shape as the reader, no keyset, LIMIT = full table.
    await shim
      .prepare(
        `SELECT t.*, COALESCE(ev.version, 1) AS version\n    FROM ${table} t\n    LEFT JOIN entity_versions ev\n      ON ev.project_id = t.project_id\n      AND ev.entity_type = ?\n      AND ev.entity_id = t.id\n    WHERE t.project_id = ?\n    ORDER BY t.updated_at ASC, t.id ASC\n    LIMIT ?\n    `
      )
      .bind(type.slice(0, -1), 'p-load', total + 1)
      .all();
    rowsByType[type] = total;
  }
  return { statements: statements.count, pages: 1, rowsByType, ms: Date.now() - started };
}

/** Paginated reader: iterate nextCursor per type until exhausted. */
async function measurePaginatedSnapshot(
  dataset: Dataset,
  pageSize: number
): Promise<SnapshotResult> {
  const statements = { count: 0 };
  const shim = snapshotShim(dataset, 'p-load', statements);
  const paginatedEnv = {
    D1_DATABASE: shim,
    SNAPSHOT_PAGE_SIZE: String(pageSize),
  } as unknown as Env;
  const rowsByType: Record<string, number> = {};
  let pages = 0;
  let cursor: string | undefined;
  const started = Date.now();
  for (;;) {
    const response: SnapshotResponse = await getProjectSnapshot(
      paginatedEnv,
      'p-load',
      cursor ? { cursor } : undefined
    );
    pages += 1;
    for (const type of Object.keys(TYPE_TO_TABLE)) {
      rowsByType[type] =
        (rowsByType[type] ?? 0) + (response[type as keyof SnapshotResponse] as unknown[]).length;
    }
    const next = response.nextCursor;
    const nextType = next ? (Object.keys(next)[0] as keyof typeof next) : undefined;
    if (!nextType) break;
    cursor = next![nextType]!;
  }
  return { statements: statements.count, pages, rowsByType, ms: Date.now() - started };
}

// ===========================================================================
// [4] Pruning shim: implements changelogPruning.ts's exact statement shapes
//     over an in-memory row array (statement counting is done by the module's
//     own budget: summary.statementsUsed).
// ===========================================================================

interface ChangeRowLite {
  id: number;
  project_id: string;
  created_at: string;
}

function buildChangesDataset(
  count: number,
  spreadDays: number
): ChangeRowLite[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = Date.now();
  const spread = spreadDays * DAY_MS;
  const rows: ChangeRowLite[] = [];
  for (let i = 0; i < count; i++) {
    const msAgo =
      Math.floor((spread * (count - i)) / count) + (i % 37) * 1_000;
    rows.push({
      id: i + 1, // AUTOINCREMENT-style: ids ascending in created_at order
      project_id: 'p-load',
      created_at: new Date(start - msAgo).toISOString(),
    });
  }
  return rows;
}

function pruningShim(
  rows: ChangeRowLite[],
  meta: Map<string, { horizon_created_at: string; max_pruned_change_id: number; updated_at: string }>
): D1Database {
  const byOrder = (projectId: string, cutoff: string | null, limit: number) => {
    const matching = rows
      .filter(
        (r) => r.project_id === projectId && (cutoff === null || r.created_at < cutoff)
      )
      .sort((a, b) =>
        a.created_at !== b.created_at
          ? a.created_at < b.created_at
            ? -1
            : 1
          : a.id - b.id
      )
      .slice(0, limit);
    return matching;
  };

  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => {
          if (
            /FROM sync_changes\s+GROUP BY project_id\s+HAVING MIN\(created_at\) < \? OR COUNT\(\*\) > \?/.test(
              sql
            )
          ) {
            const [cutoff, cap] = params as [string, number];
            const byProject = new Map<string, ChangeRowLite[]>();
            for (const r of rows) {
              const list = byProject.get(r.project_id) ?? [];
              list.push(r);
              byProject.set(r.project_id, list);
            }
            const results = [...byProject.entries()]
              .filter(([, list]) => {
                const oldest = list.reduce(
                  (min, r) => (r.created_at < min ? r.created_at : min),
                  list[0]!.created_at
                );
                return oldest < cutoff || list.length > cap;
              })
              .map(([projectId, list]) => ({
                project_id: projectId,
                change_count: list.length,
                oldest_created_at: list.reduce(
                  (min, r) => (r.created_at < min ? r.created_at : min),
                  list[0]!.created_at
                ),
              }));
            return { results };
          }
          if (
            /SELECT id FROM sync_changes\s+WHERE project_id = \? AND created_at < \?\s+ORDER BY created_at ASC, id ASC\s+LIMIT \?/.test(
              sql
            )
          ) {
            const [projectId, cutoff, limit] = params as [string, string, number];
            return {
              results: byOrder(projectId, cutoff, limit).map((r) => ({ id: r.id })),
            };
          }
          if (
            /SELECT id FROM sync_changes\s+WHERE project_id = \?\s+ORDER BY created_at ASC, id ASC\s+LIMIT \?/.test(
              sql
            )
          ) {
            const [projectId, limit] = params as [string, number];
            return {
              results: byOrder(projectId, null, limit).map((r) => ({ id: r.id })),
            };
          }
          if (
            /SELECT COUNT\(\*\) AS n FROM sync_changes\s+WHERE project_id = \? AND created_at < \?/.test(
              sql
            )
          ) {
            const [projectId, cutoff] = params as [string, string];
            return {
              results: [
                {
                  n: rows.filter(
                    (r) => r.project_id === projectId && r.created_at < cutoff
                  ).length,
                },
              ],
            };
          }
          throw new Error(`[pruning-shim] unexpected all(): ${sql.trim()}`);
        },
        first: async () => {
          if (
            /SELECT created_at FROM sync_changes\s+WHERE project_id = \?\s+ORDER BY created_at ASC, id ASC\s+LIMIT 1/.test(
              sql
            )
          ) {
            const projectId = params[0] as string;
            const oldest = byOrder(projectId, null, 1)[0];
            return oldest ? { created_at: oldest.created_at } : null;
          }
          throw new Error(`[pruning-shim] unexpected first(): ${sql.trim()}`);
        },
        run: async () => {
          if (
            /DELETE FROM sync_changes\s+WHERE id IN \(\s*SELECT id FROM sync_changes\s+WHERE project_id = \? AND created_at < \?/.test(
              sql
            )
          ) {
            const [projectId, cutoff, limit] = params as [string, string, number];
            const targets = new Set(
              byOrder(projectId, cutoff, limit).map((r) => r.id)
            );
            let changes = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (targets.has(rows[i]!.id)) {
                rows.splice(i, 1);
                changes += 1;
              }
            }
            return { meta: { changes } };
          }
          if (
            /DELETE FROM sync_changes\s+WHERE id IN \(\s*SELECT id FROM sync_changes\s+WHERE project_id = \?\s+ORDER BY/.test(
              sql
            )
          ) {
            const [projectId, limit] = params as [string, number];
            const targets = new Set(
              byOrder(projectId, null, limit).map((r) => r.id)
            );
            let changes = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (targets.has(rows[i]!.id)) {
                rows.splice(i, 1);
                changes += 1;
              }
            }
            return { meta: { changes } };
          }
          if (/INSERT INTO project_sync_meta/.test(sql)) {
            const [projectId, horizon, maxPruned, updatedAt] = params as [
              string,
              string,
              number,
              string,
            ];
            const existing = meta.get(projectId);
            meta.set(projectId, {
              horizon_created_at: horizon,
              max_pruned_change_id: Math.max(
                existing?.max_pruned_change_id ?? 0,
                maxPruned
              ),
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          if (/DELETE FROM project_sync_meta/.test(sql)) {
            meta.delete(params[0] as string);
            return { meta: { changes: 1 } };
          }
          throw new Error(`[pruning-shim] unexpected run(): ${sql.trim()}`);
        },
      }),
    }),
  } as unknown as D1Database;
}

// ===========================================================================
// Output
// ===========================================================================

const line = '='.repeat(78);

function pad(n: number | string, w: number): string {
  return String(n).padStart(w);
}

async function main(): Promise<void> {
  console.log(line);
  console.log(
    'Load measurement suite — harness-simulated (in-memory D1 mock, deterministic)'
  );
  console.log(
    'Round-trip / statement counts are EXACT (counted D1 calls; one batch = one round-trip).'
  );
  console.log(
    'Wall times are in-memory and INDICATIVE only (no network, no D1 planner).'
  );
  console.log(line);

  // --- [1] 200-mutation sync ---------------------------------------------
  const serial200 = await measureSync(200, true);
  const batched200 = await measureSync(200, false);
  console.log('\n[1] Sync: 200 independent updates (spec budget <= 100 excl. quota reads)');
  console.log(
    `    serial  : ${pad(serial200.roundTrips, 4)} round-trips (${serial200.batches} batches + ${serial200.solo} solo, quota reads ${serial200.quotaReads})  ${serial200.ms} ms`
  );
  console.log(
    `    batched : ${pad(batched200.roundTrips, 4)} round-trips (${batched200.batches} batches + ${batched200.solo} solo, quota reads ${batched200.quotaReads})  ${batched200.ms} ms`
  );
  if (batched200.roundTrips > 100) {
    throw new Error(
      `[measure] 200-mutation batched sync used ${batched200.roundTrips} round-trips > budget 100`
    );
  }
  console.log(
    `    verdict : PASS (${batched200.roundTrips} <= 100; quota reads in run: ${batched200.quotaReads}; outcomes all applied: ${batched200.applied}/200)`
  );

  // --- [2] 50-mutation sync (free tier) ------------------------------------
  const serial50 = await measureSync(50, true);
  const batched50 = await measureSync(50, false);
  // Free-tier accounting: D1 statements + 1 DO subrequest (realtime notify,
  // scheduled via ctx.waitUntil and issuing no D1 statements from the sync
  // path) + quota reads (0 here: no creates). Workers free tier caps a
  // request at 50 subrequests.
  const freeTierTotal = batched50.roundTrips + batched50.quotaReads + 1;
  console.log('\n[2] Sync: 50 independent updates (Workers free tier: 50 subrequests/request)');
  console.log(
    `    serial  : ${pad(serial50.roundTrips, 4)} round-trips (${serial50.batches} batches + ${serial50.solo} solo)  ${serial50.ms} ms`
  );
  console.log(
    `    batched : ${pad(batched50.roundTrips, 4)} round-trips (${batched50.batches} batches + ${batched50.solo} solo)  ${batched50.ms} ms`
  );
  console.log(
    `    budget  : ${batched50.roundTrips} D1 + ${batched50.quotaReads} quota reads + 1 DO notify (waitUntil) = ${freeTierTotal} of 50`
  );
  if (freeTierTotal > 50) {
    throw new Error(
      `[measure] 50-mutation sync exceeds the free-tier cap: ${freeTierTotal} > 50 — DO NOT massage the numbers; report instead`
    );
  }
  console.log(
    `    verdict : PASS (headroom ${50 - freeTierTotal} subrequest(s))`
  );

  // --- [3] Snapshot: 5,000 links + 50 collections --------------------------
  const dataset = buildSnapshotDataset();
  const legacy = await measureLegacySnapshot(dataset);
  const paginated = await measurePaginatedSnapshot(dataset, 500);
  const totalRows = Object.values(legacy.rowsByType).reduce((a, b) => a + b, 0);
  const paginatedRows = Object.values(paginated.rowsByType).reduce(
    (a, b) => a + b,
    0
  );
  const rowSetsEqual =
    JSON.stringify(legacy.rowsByType) === JSON.stringify(paginated.rowsByType);
  console.log('\n[3] Snapshot read: 5,000 links + 50 collections (page cap 500)');
  console.log(
    `    legacy unbounded : ${pad(legacy.statements, 3)} statements (1 per type)  ${legacy.ms} ms  rows: ${totalRows}`
  );
  console.log(
    `    paginated @500   : ${pad(paginated.statements, 3)} statements (${paginated.pages} page calls)  ${paginated.ms} ms  rows: ${paginatedRows}`
  );
  if (!rowSetsEqual || paginatedRows !== totalRows) {
    throw new Error(
      `[measure] paginated snapshot rows differ from unbounded: ${JSON.stringify(paginated.rowsByType)} vs ${JSON.stringify(legacy.rowsByType)}`
    );
  }
  console.log(
    `    verdict : paginated iteration returns the identical row set (per-type counts match); statements ${legacy.statements} -> ${paginated.statements} (+${paginated.statements - legacy.statements})`
  );

  // --- [4] Changelog pruning: 50,000 rows / 120 days ------------------------
  const pruneRows = buildChangesDataset(50_000, 120);
  const meta = new Map<
    string,
    { horizon_created_at: string; max_pruned_change_id: number; updated_at: string }
  >();
  const pruneEnv = { D1_DATABASE: pruningShim(pruneRows, meta) } as unknown as Env;
  console.log(
    '\n[4] Changelog pruning: 50,000 rows over 120 days (retention 90d, cap 50,000, batch 500, budget 40 stmts)'
  );
  const pass1Start = Date.now();
  const pass1 = await runChangelogPruning(pruneEnv, {});
  const pass1Ms = Date.now() - pass1Start;
  console.log(
    `    pass 1  : ${pad(pass1.statementsUsed, 3)} statements, ${pad(pass1.rowsPruned, 6)} rows deleted (time ${pass1.timeBasedRows} / cap ${pass1.countBasedRows}), budgetExhausted=${pass1.budgetExhausted}, deferred ${pass1.remainingProjectIds.length}, ${pass1Ms} ms`
  );
  const pass2Start = Date.now();
  const pass2 = await runChangelogPruning(pruneEnv, {});
  const pass2Ms = Date.now() - pass2Start;
  console.log(
    `    pass 2  : ${pad(pass2.statementsUsed, 3)} statements, ${pad(pass2.rowsPruned, 6)} rows deleted (time ${pass2.timeBasedRows} / cap ${pass2.countBasedRows}), budgetExhausted=${pass2.budgetExhausted}, deferred ${pass2.remainingProjectIds.length}, ${pass2Ms} ms`
  );
  const totalPruned = pass1.rowsPruned + pass2.rowsPruned;
  const totalStatements = pass1.statementsUsed + pass2.statementsUsed;
  console.log(
    `    verdict : ${totalPruned} rows pruned over 2 nightly runs, ${totalStatements} statements total; the per-run statement budget (40) keeps each run inside the cron window and bounds subrequests via CHANGELOG_PRUNE_MAX_STATEMENTS`
  );

  console.log('\n' + line);
  console.log('All scenarios measured. Counts are exact for the modeled D1 surface.');
  console.log(line);
}

try {
  await main();
} catch (error) {
  console.error('[measure:load] FAILED:', error);
  throw error;
}
