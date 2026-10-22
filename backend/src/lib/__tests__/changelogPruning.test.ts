import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runChangelogPruning } from '../changelogPruning';
import type { Env } from '../../types';

// Suites for the scheduled changelog pruning (change-log-retention). Runs the
// pure lib against a focused in-memory D1 mock (same approach as
// login-codes.test.ts: the shared `cases/harness.ts` models the sync engine's
// SQL shapes; pruning issues different ones). The mock records every issued
// statement so the statement-budget test can count them.

/** Fixed "now" for every run; the retention cutoff is NOW - 90 days. */
const NOW = '2026-01-01T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp `days` before NOW. */
function daysBeforeNow(days: number): string {
  return new Date(new Date(NOW).getTime() - days * DAY_MS).toISOString();
}

interface SeedChange {
  id: number;
  project_id: string;
  created_at: string;
}

interface MetaRow {
  project_id: string;
  horizon_created_at: string;
  max_pruned_change_id: number;
  updated_at: string;
}

/**
 * In-memory D1 mock covering exactly the SQL shapes `changelogPruning.ts`
 * issues, with real row predicates so `meta.changes` behaves like D1.
 */
function makePruneEnv(
  seed: {
    changes?: SeedChange[];
    meta?: MetaRow[];
    vars?: Record<string, string>;
  } = {}
): {
  env: Env;
  changes: SeedChange[];
  meta: MetaRow[];
  statements: { sql: string; params: unknown[] }[];
} {
  const changes: SeedChange[] = (seed.changes ?? []).map((c) => ({ ...c }));
  const meta: MetaRow[] = (seed.meta ?? []).map((m) => ({ ...m }));
  const statements: { sql: string; params: unknown[] }[] = [];

  const byCreatedThenId = (a: SeedChange, b: SeedChange) =>
    a.created_at.localeCompare(b.created_at) || a.id - b.id;

  /** Evaluate the lib's ordered id-batch subselect against live rows. */
  function selectIds(
    projectId: string,
    cutoff: string | null,
    limit: number
  ): number[] {
    return changes
      .filter(
        (c) =>
          c.project_id === projectId &&
          (cutoff === null || c.created_at < cutoff)
      )
      .sort(byCreatedThenId)
      .slice(0, limit)
      .map((c) => c.id);
  }

  function exec(
    rawSql: string,
    params: unknown[]
  ): { results?: unknown[]; meta?: { changes: number } } {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    statements.push({ sql: rawSql, params });

    // Candidate scan (GROUP BY project_id HAVING ...).
    if (sql.includes('GROUP BY project_id')) {
      const [cutoff, cap] = params as [string, number];
      const groups = new Map<string, SeedChange[]>();
      for (const c of changes) {
        const list = groups.get(c.project_id) ?? [];
        list.push(c);
        groups.set(c.project_id, list);
      }
      const results = [...groups.entries()]
        .map(([projectId, rows]) => ({
          project_id: projectId,
          change_count: rows.length,
          oldest_created_at: [...rows]
            .sort(byCreatedThenId)[0].created_at,
        }))
        .filter(
          (g) => g.oldest_created_at < cutoff || g.change_count > cap
        );
      return { results };
    }

    // Bounded delete: evaluate the same subselect, then remove those rows.
    if (sql.startsWith('DELETE FROM sync_changes WHERE id IN')) {
      const timeBased = sql.includes('created_at < ?');
      const [projectId, second, third] = params as [string, unknown, unknown];
      const cutoff = timeBased ? (second as string) : null;
      const limit = (timeBased ? third : second) as number;
      const ids = selectIds(projectId, cutoff, limit);
      let removed = 0;
      for (const id of ids) {
        const index = changes.findIndex((c) => c.id === id);
        if (index !== -1) {
          changes.splice(index, 1);
          removed += 1;
        }
      }
      return { meta: { changes: removed } };
    }

    // Id batch reads.
    if (sql.startsWith('SELECT id FROM sync_changes WHERE')) {
      const timeBased = sql.includes('created_at < ?');
      const [projectId, second, third] = params as [string, unknown, unknown];
      const cutoff = timeBased ? (second as string) : null;
      const limit = (timeBased ? third : second) as number;
      return { results: selectIds(projectId, cutoff, limit).map((id) => ({ id })) };
    }

    // Oldest retained row (post-prune horizon read).
    if (sql.startsWith('SELECT created_at FROM sync_changes')) {
      const [projectId] = params as [string];
      const oldest = changes
        .filter((c) => c.project_id === projectId)
        .sort(byCreatedThenId)[0];
      return { results: oldest ? [{ created_at: oldest.created_at }] : [] };
    }

    // Dry-run retention count.
    if (sql.startsWith('SELECT COUNT(*) AS n FROM sync_changes')) {
      const [projectId, cutoff] = params as [string, string];
      const n = changes.filter(
        (c) => c.project_id === projectId && c.created_at < cutoff
      ).length;
      return { results: [{ n }] };
    }

    // project_sync_meta upsert (historical max folded via scalar MAX()).
    if (sql.startsWith('INSERT INTO project_sync_meta')) {
      const [projectId, horizon, maxPruned, updatedAt] = params as [
        string,
        string,
        number,
        string
      ];
      const existing = meta.find((m) => m.project_id === projectId);
      if (existing) {
        existing.horizon_created_at = horizon;
        existing.max_pruned_change_id = Math.max(
          existing.max_pruned_change_id,
          maxPruned
        );
        existing.updated_at = updatedAt;
      } else {
        meta.push({
          project_id: projectId,
          horizon_created_at: horizon,
          max_pruned_change_id: maxPruned,
          updated_at: updatedAt,
        });
      }
      return { meta: { changes: 1 } };
    }

    // project_sync_meta row removal (change log fully emptied).
    if (sql.startsWith('DELETE FROM project_sync_meta')) {
      const [projectId] = params as [string];
      const index = meta.findIndex((m) => m.project_id === projectId);
      if (index === -1) return { meta: { changes: 0 } };
      meta.splice(index, 1);
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const result = exec(sql, params);
              return (result.results?.[0] as T) ?? null;
            },
            async all<T>(): Promise<{ results: T[] }> {
              const result = exec(sql, params);
              return { results: (result.results ?? []) as T[] };
            },
            async run(): Promise<{ meta: { changes: number } }> {
              const result = exec(sql, params);
              return { meta: result.meta ?? { changes: 0 } };
            },
          };
        },
      };
    },
  };

  return {
    env: {
      D1_DATABASE: database,
      JWT_SECRET: 'test-secret-do-not-use-in-prod-123456',
      ...(seed.vars ?? {}),
    } as unknown as Env,
    changes,
    meta,
    statements,
  };
}

describe('runChangelogPruning', () => {
  let logSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('retention prune: deletes rows older than the window, retains the rest, records the horizon', async () => {
    const { env, changes, meta, statements } = makePruneEnv({
      changes: [
        { id: 1, project_id: 'p1', created_at: daysBeforeNow(200) },
        { id: 2, project_id: 'p1', created_at: daysBeforeNow(150) },
        { id: 3, project_id: 'p1', created_at: daysBeforeNow(120) },
        { id: 4, project_id: 'p1', created_at: daysBeforeNow(10) },
        { id: 5, project_id: 'p1', created_at: daysBeforeNow(1) },
      ],
    });

    const summary = await runChangelogPruning(env, { now: NOW });

    // Old rows deleted, newer rows retained.
    expect(changes.map((c) => c.id).sort((a, b) => a - b)).toEqual([4, 5]);
    // Horizon row correct: oldest retained created_at + max deleted id.
    expect(meta).toEqual([
      {
        project_id: 'p1',
        horizon_created_at: daysBeforeNow(10),
        max_pruned_change_id: 3,
        updated_at: NOW,
      },
    ]);
    expect(summary.dryRun).toBe(false);
    expect(summary.projectsPruned).toBe(1);
    expect(summary.timeBasedRows).toBe(3);
    expect(summary.countBasedRows).toBe(0);
    expect(summary.rowsPruned).toBe(3);
    expect(summary.budgetExhausted).toBe(false);
    // The DELETE uses the prescribed bounded id-subselect shape.
    const deleteSql = statements
      .map((s) => s.sql.replace(/\s+/g, ' ').trim())
      .find((sql) => sql.startsWith('DELETE FROM sync_changes'));
    expect(deleteSql).toBe(
      'DELETE FROM sync_changes WHERE id IN ( SELECT id FROM sync_changes WHERE project_id = ? AND created_at < ? ORDER BY created_at ASC, id ASC LIMIT ? )'
    );
  });

  it('count-cap prune: trims to the cap deleting the OLDEST rows first', async () => {
    // 15 rows, created_at ascending with id; cap 10 → overflow ids 1..5.
    const { env, changes, meta } = makePruneEnv({
      vars: { CHANGELOG_MAX_ROWS_PER_PROJECT: '10' },
      changes: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        project_id: 'p1',
        created_at: daysBeforeNow(16 - (i + 1)),
      })),
    });

    const summary = await runChangelogPruning(env, { now: NOW });

    // Survivors are the newest 10 rows (ids 6..15).
    expect(changes.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    // max_pruned_change_id = max id actually deleted.
    expect(meta).toEqual([
      {
        project_id: 'p1',
        horizon_created_at: daysBeforeNow(10), // id 6 = oldest survivor
        max_pruned_change_id: 5,
        updated_at: NOW,
      },
    ]);
    expect(summary.timeBasedRows).toBe(0);
    expect(summary.countBasedRows).toBe(5);
    expect(summary.rowsPruned).toBe(5);
  });

  it('meta bookkeeping: a second run with nothing to prune changes nothing', async () => {
    const { env, changes, meta, statements } = makePruneEnv({
      changes: [
        { id: 1, project_id: 'p1', created_at: daysBeforeNow(200) },
        { id: 2, project_id: 'p1', created_at: daysBeforeNow(10) },
        { id: 3, project_id: 'p1', created_at: daysBeforeNow(1) },
      ],
    });

    await runChangelogPruning(env, { now: NOW });
    const changesAfterFirst = structuredClone(changes);
    const metaAfterFirst = structuredClone(meta);
    expect(metaAfterFirst).toHaveLength(1);
    const statementsAfterFirst = statements.length;

    const summary = await runChangelogPruning(env, {
      now: daysBeforeNow(-1 / 24), // one hour later
    });

    expect(changes).toEqual(changesAfterFirst);
    expect(meta).toEqual(metaAfterFirst); // identical incl. updated_at
    expect(summary.rowsPruned).toBe(0);
    expect(summary.projectsPruned).toBe(0);
    expect(summary.budgetExhausted).toBe(false);
    // No DELETE/meta statements at all on the clean second run (only the
    // statements run 2 issued are inspected; run 1 legitimately deleted).
    const runTwoSqls = statements
      .slice(statementsAfterFirst)
      .map((s) => s.sql.replace(/\s+/g, ' ').trim());
    expect(runTwoSqls.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    expect(
      runTwoSqls.some((sql) => sql.startsWith('INSERT INTO project_sync_meta'))
    ).toBe(false);
  });

  it('meta bookkeeping: a project emptied to zero rows has its meta row removed', async () => {
    const { env, changes, meta } = makePruneEnv({
      changes: [
        { id: 1, project_id: 'p1', created_at: daysBeforeNow(200) },
        { id: 2, project_id: 'p1', created_at: daysBeforeNow(150) },
      ],
      meta: [
        {
          project_id: 'p1',
          horizon_created_at: daysBeforeNow(200),
          max_pruned_change_id: 1,
          updated_at: daysBeforeNow(100),
        },
      ],
    });

    const summary = await runChangelogPruning(env, { now: NOW });

    expect(changes.filter((c) => c.project_id === 'p1')).toEqual([]);
    expect(meta).toEqual([]);
    expect(summary.projects[0]).toMatchObject({
      projectId: 'p1',
      timeBasedRows: 2,
      horizonCreatedAt: null,
      metaDeleted: true,
      maxPrunedChangeId: 2,
    });
  });

  it('budget: stops cleanly at the statement limit, logs what remains, and still records the horizon', async () => {
    const { env, changes, meta, statements } = makePruneEnv({
      vars: {
        CHANGELOG_PRUNE_BATCH_ROWS: '2',
        CHANGELOG_PRUNE_MAX_STATEMENTS: '6',
      },
      changes: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        project_id: 'p1',
        created_at: new Date(
          new Date(daysBeforeNow(200)).getTime() + i
        ).toISOString(),
      })),
    });

    const summary = await runChangelogPruning(env, { now: NOW });

    // Budget: 1 candidates + 1 select + 1 delete + 1 horizon read + 1 upsert
    // = 5 statements; the second batch (needs 4 with the bookkeeping reserve)
    // no longer fits.
    expect(statements).toHaveLength(5);
    expect(summary.statementsUsed).toBe(5);
    expect(summary.budgetExhausted).toBe(true);
    expect(summary.remainingProjectIds).toEqual(['p1']);
    // Only the first batch (2 rows) was deleted; 8 remain for the next run.
    expect(changes.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // Bookkeeping closed out within the same run despite the partial prune.
    expect(meta).toEqual([
      {
        project_id: 'p1',
        horizon_created_at: new Date(
          new Date(daysBeforeNow(200)).getTime() + 2
        ).toISOString(), // id 3 = oldest survivor
        max_pruned_change_id: 2,
        updated_at: NOW,
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deferring 1 project(s)')
    );
  });

  it('dry run: deletes nothing but logs per-project counts', async () => {
    const { env, changes, meta, statements } = makePruneEnv({
      vars: { CHANGELOG_PRUNE_DRY_RUN: '1' },
      changes: [
        { id: 1, project_id: 'p1', created_at: daysBeforeNow(200) },
        { id: 2, project_id: 'p1', created_at: daysBeforeNow(150) },
        { id: 3, project_id: 'p1', created_at: daysBeforeNow(120) },
        { id: 4, project_id: 'p1', created_at: daysBeforeNow(10) },
      ],
    });

    const summary = await runChangelogPruning(env, { now: NOW });

    expect(summary.dryRun).toBe(true);
    expect(summary.rowsPruned).toBe(0);
    expect(summary.dryRunEstimates).toEqual([
      { projectId: 'p1', timeBasedRows: 3, countBasedRows: 0 },
    ]);
    // Nothing deleted, no meta writes.
    expect(changes.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(meta).toEqual([]);
    const sqls = statements.map((s) => s.sql.replace(/\s+/g, ' ').trim());
    expect(sqls.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    expect(sqls.some((sql) => sql.startsWith('INSERT INTO project_sync_meta'))).toBe(false);
    // What WOULD be deleted is logged per project.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"dryRun":true')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"timeBasedRows":3')
    );
  });

  it('active-cursor safety: a recent row inside the retention window survives a retention prune', async () => {
    const { env, changes, meta } = makePruneEnv({
      changes: [
        { id: 1, project_id: 'p1', created_at: daysBeforeNow(200) },
        { id: 2, project_id: 'p1', created_at: daysBeforeNow(150) },
        { id: 3, project_id: 'p1', created_at: daysBeforeNow(1) }, // recent
      ],
    });

    await runChangelogPruning(env, { now: NOW });

    // The recent row (inside the 90-day window) survives even though old rows
    // existed, and its id sits above the recorded pruning horizon — so the
    // sync-request staleness check will never flag its cursor as stale.
    expect(changes.map((c) => c.id)).toEqual([3]);
    expect(meta[0].max_pruned_change_id).toBe(2);
    expect(3).toBeGreaterThan(meta[0].max_pruned_change_id);
  });
});
