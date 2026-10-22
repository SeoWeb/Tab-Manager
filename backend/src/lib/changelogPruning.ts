import type { Env } from '../types';

/**
 * Scheduled pruning of the `sync_changes` change log
 * (openspec: scale-sync-backend, change-log-retention).
 *
 * Invoked from the worker's `scheduled` handler on the "30 3 * * *" cron.
 * Per project it deletes, oldest first and in bounded batches:
 *   1. rows older than the retention window (`CHANGELOG_RETENTION_DAYS`,
 *      default 90 days);
 *   2. the oldest overflow above the per-project row cap
 *      (`CHANGELOG_MAX_ROWS_PER_PROJECT`, default 50 000).
 *
 * Bounded work: SQLite/D1 has no reliable `DELETE ... LIMIT`, so every batch
 * is `DELETE ... WHERE id IN (SELECT id ... ORDER BY created_at ASC, id ASC
 * LIMIT ?)` of at most `CHANGELOG_PRUNE_BATCH_ROWS` rows (default 500), and
 * the whole run spends at most `CHANGELOG_PRUNE_MAX_STATEMENTS` statements
 * (default 40). When the budget runs out the run stops cleanly and logs the
 * projects it deferred — the next day's run continues, since pruning is
 * idempotent by design.
 *
 * Every run that deleted rows also refreshes `project_sync_meta`
 * (migration 0007): the pruning horizon the incremental-sync staleness check
 * compares client cursors against. `CHANGELOG_PRUNE_DRY_RUN=1` executes only
 * the reads and logs what would be deleted.
 */

/** Retention window (days). Rows older than this are pruned. */
export const DEFAULT_CHANGELOG_RETENTION_DAYS = 90;
/** Per-project row cap; the oldest overflow is pruned. */
export const DEFAULT_CHANGELOG_MAX_ROWS_PER_PROJECT = 50_000;
/** Rows deleted per DELETE statement. */
export const DEFAULT_CHANGELOG_PRUNE_BATCH_ROWS = 500;
/** Total statements (DELETEs + bookkeeping) one run may spend. */
export const DEFAULT_CHANGELOG_PRUNE_MAX_STATEMENTS = 40;

/**
 * Statements (horizon read + meta write) a batch loop must leave unspent so a
 * project that started deleting rows can always close out its
 * `project_sync_meta` bookkeeping within the same run.
 */
const BOOKKEEPING_RESERVE = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// One indexed pass over idx_sync_changes_project_created_at (migration 0006)
// yields the prunable candidates plus the two facts each phase needs: the row
// count (count cap) and the oldest created_at (retention window).
const CANDIDATES_SQL = `
  SELECT project_id, COUNT(*) AS change_count, MIN(created_at) AS oldest_created_at
  FROM sync_changes
  GROUP BY project_id
  HAVING MIN(created_at) < ? OR COUNT(*) > ?
`;

// Oldest-first id batch reads (time-based predicate, then count-cap tail).
const SELECT_TIME_BATCH_SQL = `
  SELECT id FROM sync_changes
  WHERE project_id = ? AND created_at < ?
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`;
const SELECT_OVERFLOW_BATCH_SQL = `
  SELECT id FROM sync_changes
  WHERE project_id = ?
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`;

// Bounded deletes: the batch is spelled out as an ordered id subselect that
// re-evaluates the same predicate the preceding id read used.
const DELETE_TIME_BATCH_SQL = `
  DELETE FROM sync_changes
  WHERE id IN (
    SELECT id FROM sync_changes
    WHERE project_id = ? AND created_at < ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  )
`;
const DELETE_OVERFLOW_BATCH_SQL = `
  DELETE FROM sync_changes
  WHERE id IN (
    SELECT id FROM sync_changes
    WHERE project_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  )
`;

// Post-prune bookkeeping (migration 0007).
const OLDEST_RETAINED_SQL = `
  SELECT created_at FROM sync_changes
  WHERE project_id = ?
  ORDER BY created_at ASC, id ASC
  LIMIT 1
`;
const UPSERT_META_SQL = `
  INSERT INTO project_sync_meta
    (project_id, horizon_created_at, max_pruned_change_id, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(project_id) DO UPDATE SET
    horizon_created_at = excluded.horizon_created_at,
    max_pruned_change_id = MAX(max_pruned_change_id, excluded.max_pruned_change_id),
    updated_at = excluded.updated_at
`;
const DELETE_META_SQL = `
  DELETE FROM project_sync_meta WHERE project_id = ?
`;
// Dry-run only: exact count of retention-expired rows for one project.
const COUNT_RETENTION_DUE_SQL = `
  SELECT COUNT(*) AS n FROM sync_changes
  WHERE project_id = ? AND created_at < ?
`;

export interface RunChangelogPruningOptions {
  /**
   * ISO timestamp treated as "now" (defaults to the wall clock). Tests pass
   * this to keep the retention window deterministic.
   */
  now?: string;
}

/** What happened to one project during a real (non-dry) pruning run. */
export interface PrunedProjectReport {
  projectId: string;
  /** Rows deleted because they predate the retention window. */
  timeBasedRows: number;
  /** Rows deleted to bring the project under the per-project row cap. */
  countBasedRows: number;
  /** Oldest retained `created_at` after pruning (null when fully emptied). */
  horizonCreatedAt: string | null;
  /** MAX(sync_changes.id) deleted for the project by this run. */
  maxPrunedChangeId: number;
  /** True when the change log was emptied and the meta row removed. */
  metaDeleted: boolean;
}

/** Dry-run estimate for one project: what a real run would delete. */
export interface DryRunProjectEstimate {
  projectId: string;
  timeBasedRows: number;
  countBasedRows: number;
}

export interface ChangelogPruningSummary {
  dryRun: boolean;
  retentionDays: number;
  maxRowsPerProject: number;
  batchRows: number;
  maxStatements: number;
  /** Statements actually issued (SELECTs + DELETEs + meta writes). */
  statementsUsed: number;
  /** Projects found prunable by the candidate scan. */
  candidates: number;
  /** Projects that were actually pruned (0 in dry runs). */
  projectsPruned: number;
  rowsPruned: number;
  timeBasedRows: number;
  countBasedRows: number;
  budgetExhausted: boolean;
  /** Projects deferred to the next run because the budget ran out. */
  remainingProjectIds: string[];
  /** Per-project reports, in candidate order (real runs only). */
  projects: PrunedProjectReport[];
  /** Per-project estimates (dry runs only). */
  dryRunEstimates: DryRunProjectEstimate[];
}

interface PruningConfig {
  retentionDays: number;
  maxRowsPerProject: number;
  batchRows: number;
  maxStatements: number;
  dryRun: boolean;
}

/** One row of the candidate scan. */
interface CandidateRow {
  project_id: string;
  change_count: number;
  oldest_created_at: string;
}

/** Outcome of one pruning phase (retention or count cap) for a project. */
interface PhaseResult {
  rowsDeleted: number;
  maxPrunedId: number;
  /** False when the statement budget stopped the phase early. */
  complete: boolean;
}

/** Running statement budget shared by every statement the run issues. */
interface StatementBudget {
  used: number;
  canSpend(n: number): boolean;
  spend(n?: number): boolean;
  remaining(): number;
}

function intOverride(
  value: string | undefined,
  fallback: number,
  min: number
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function resolvePruningConfig(env: Env): PruningConfig {
  return {
    retentionDays: intOverride(
      env.CHANGELOG_RETENTION_DAYS,
      DEFAULT_CHANGELOG_RETENTION_DAYS,
      1
    ),
    maxRowsPerProject: intOverride(
      env.CHANGELOG_MAX_ROWS_PER_PROJECT,
      DEFAULT_CHANGELOG_MAX_ROWS_PER_PROJECT,
      1
    ),
    batchRows: intOverride(
      env.CHANGELOG_PRUNE_BATCH_ROWS,
      DEFAULT_CHANGELOG_PRUNE_BATCH_ROWS,
      1
    ),
    maxStatements: intOverride(
      env.CHANGELOG_PRUNE_MAX_STATEMENTS,
      DEFAULT_CHANGELOG_PRUNE_MAX_STATEMENTS,
      1
    ),
    dryRun:
      env.CHANGELOG_PRUNE_DRY_RUN === '1' ||
      env.CHANGELOG_PRUNE_DRY_RUN === 'true',
  };
}

function makeBudget(maxStatements: number): StatementBudget {
  return {
    used: 0,
    canSpend(n) {
      return this.used + n <= maxStatements;
    },
    spend(n = 1) {
      if (!this.canSpend(n)) return false;
      this.used += n;
      return true;
    },
    remaining() {
      return maxStatements - this.used;
    },
  };
}

/**
 * Run one changelog pruning pass. Safe to run concurrently with traffic and
 * with itself: every statement is bounded, idempotent, and re-derives its
 * targets from live committed state.
 */
export async function runChangelogPruning(
  env: Env,
  opts: RunChangelogPruningOptions = {}
): Promise<ChangelogPruningSummary> {
  const config = resolvePruningConfig(env);
  const nowIso = opts.now ?? new Date().toISOString();
  const cutoffIso = new Date(
    new Date(nowIso).getTime() - config.retentionDays * DAY_MS
  ).toISOString();

  const summary: ChangelogPruningSummary = {
    dryRun: config.dryRun,
    retentionDays: config.retentionDays,
    maxRowsPerProject: config.maxRowsPerProject,
    batchRows: config.batchRows,
    maxStatements: config.maxStatements,
    statementsUsed: 0,
    candidates: 0,
    projectsPruned: 0,
    rowsPruned: 0,
    timeBasedRows: 0,
    countBasedRows: 0,
    budgetExhausted: false,
    remainingProjectIds: [],
    projects: [],
    dryRunEstimates: [],
  };

  const budget = makeBudget(config.maxStatements);

  // Candidate scan: one indexed pass lists every project that needs pruning
  // by either criterion, with its row count and oldest created_at.
  if (!budget.spend()) {
    summary.budgetExhausted = true;
    finishRun(summary, cutoffIso);
    return summary;
  }
  const { results: candidates } = await env.D1_DATABASE.prepare(CANDIDATES_SQL)
    .bind(cutoffIso, config.maxRowsPerProject)
    .all<CandidateRow>();
  summary.candidates = candidates.length;

  if (config.dryRun) {
    await estimateProjects(env, budget, config, cutoffIso, candidates, summary);
  } else {
    await pruneProjects(
      env,
      budget,
      config,
      cutoffIso,
      nowIso,
      candidates,
      summary
    );
  }

  summary.statementsUsed = budget.used;
  finishRun(summary, cutoffIso);
  return summary;
}

function finishRun(
  summary: ChangelogPruningSummary,
  cutoffIso: string
): void {
  console.log(
    `[changelog-prune] run complete ${JSON.stringify({
      dryRun: summary.dryRun,
      retentionCutoff: cutoffIso,
      candidates: summary.candidates,
      projectsPruned: summary.projectsPruned,
      rowsPruned: summary.rowsPruned,
      statementsUsed: summary.statementsUsed,
      budgetExhausted: summary.budgetExhausted,
      remainingProjects: summary.remainingProjectIds.length,
    })}`
  );
  if (summary.budgetExhausted && summary.remainingProjectIds.length > 0) {
    console.warn(
      `[changelog-prune] statement budget (${summary.maxStatements}) exhausted; ` +
        `deferring ${summary.remainingProjectIds.length} project(s) to the next run: ` +
        `${summary.remainingProjectIds.join(',')}`
    );
  }
}

/** Dry-run: measure (never delete) what a real run would remove per project. */
async function estimateProjects(
  env: Env,
  budget: StatementBudget,
  config: PruningConfig,
  cutoffIso: string,
  candidates: CandidateRow[],
  summary: ChangelogPruningSummary
): Promise<void> {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let timeBasedRows = 0;
    if (candidate.oldest_created_at < cutoffIso) {
      if (!budget.spend()) {
        summary.budgetExhausted = true;
        summary.remainingProjectIds.push(
          ...candidates.slice(index).map((c) => c.project_id)
        );
        break;
      }
      const row = await env.D1_DATABASE.prepare(COUNT_RETENTION_DUE_SQL)
        .bind(candidate.project_id, cutoffIso)
        .first<{ n: number }>();
      timeBasedRows = row?.n ?? 0;
    }
    const estimate: DryRunProjectEstimate = {
      projectId: candidate.project_id,
      timeBasedRows,
      countBasedRows: Math.max(
        0,
        candidate.change_count - config.maxRowsPerProject
      ),
    };
    summary.dryRunEstimates.push(estimate);
    console.log(
      `[changelog-prune] ${JSON.stringify({
        projectId: estimate.projectId,
        dryRun: true,
        timeBasedRows: estimate.timeBasedRows,
        countBasedRows: estimate.countBasedRows,
        statementsUsed: budget.used,
      })}`
    );
  }
}

/** Real run: prune every candidate project, oldest rows first. */
async function pruneProjects(
  env: Env,
  budget: StatementBudget,
  config: PruningConfig,
  cutoffIso: string,
  nowIso: string,
  candidates: CandidateRow[],
  summary: ChangelogPruningSummary
): Promise<void> {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!budget.canSpend(1)) {
      summary.budgetExhausted = true;
      summary.remainingProjectIds.push(
        ...candidates.slice(index).map((c) => c.project_id)
      );
      break;
    }

    const projectId = candidate.project_id;
    try {
      // Phase 1: retention window (only when the oldest row is expired).
      const timePhase = candidate.oldest_created_at < cutoffIso
        ? await pruneByRetention(
            env,
            budget,
            projectId,
            cutoffIso,
            config.batchRows
          )
        : { rowsDeleted: 0, maxPrunedId: 0, complete: true };

      // Phase 2: count cap. Start from the candidate count minus what phase 1
      // already removed; concurrent inserts self-correct on a later run.
      const countPhase = timePhase.complete
        ? await pruneByCountCap(
            env,
            budget,
            projectId,
            candidate.change_count - timePhase.rowsDeleted,
            config.maxRowsPerProject,
            config.batchRows
          )
        : { rowsDeleted: 0, maxPrunedId: 0, complete: false };

      const rowsDeleted = timePhase.rowsDeleted + countPhase.rowsDeleted;
      const maxPrunedId = Math.max(
        timePhase.maxPrunedId,
        countPhase.maxPrunedId
      );

      if (!timePhase.complete || !countPhase.complete) {
        summary.budgetExhausted = true;
        summary.remainingProjectIds.push(projectId);
      }
      if (rowsDeleted === 0) continue; // stale candidate; nothing to record

      // Every DELETE run updates the pruning horizon bookkeeping (task 4.2).
      const meta = await updatePruningMeta(
        env,
        budget,
        projectId,
        maxPrunedId,
        nowIso
      );

      const report: PrunedProjectReport = {
        projectId,
        timeBasedRows: timePhase.rowsDeleted,
        countBasedRows: countPhase.rowsDeleted,
        horizonCreatedAt: meta.horizonCreatedAt,
        maxPrunedChangeId: maxPrunedId,
        metaDeleted: meta.metaDeleted,
      };
      summary.projects.push(report);
      summary.projectsPruned += 1;
      summary.timeBasedRows += report.timeBasedRows;
      summary.countBasedRows += report.countBasedRows;
      summary.rowsPruned += rowsDeleted;
      console.log(
        `[changelog-prune] ${JSON.stringify({
          projectId,
          dryRun: false,
          timeBasedRows: report.timeBasedRows,
          countBasedRows: report.countBasedRows,
          maxPrunedChangeId: report.maxPrunedChangeId,
          horizonCreatedAt: report.horizonCreatedAt,
          metaDeleted: report.metaDeleted,
          statementsUsed: budget.used,
        })}`
      );
    } catch (error) {
      // One bad project must not stop the run; it retries tomorrow anyway.
      console.error(`[changelog-prune] project ${projectId} failed`, error);
      summary.remainingProjectIds.push(projectId);
    }
  }
}

/**
 * Delete rows predating the retention window, oldest first, in batches until
 * the predicate yields nothing (or the budget stops us).
 */
async function pruneByRetention(
  env: Env,
  budget: StatementBudget,
  projectId: string,
  cutoffIso: string,
  batchRows: number
): Promise<PhaseResult> {
  let rowsDeleted = 0;
  let maxPrunedId = 0;
  for (;;) {
    // A batch needs a read + a delete; BOOKKEEPING_RESERVE stays unspent so
    // this project's meta bookkeeping can always close out this run.
    if (!budget.canSpend(2 + BOOKKEEPING_RESERVE)) {
      return { rowsDeleted, maxPrunedId, complete: false };
    }
    const ids = await selectOldestIds(env, projectId, cutoffIso, batchRows);
    budget.spend();
    if (ids.length === 0) return { rowsDeleted, maxPrunedId, complete: true };
    budget.spend();
    const changes = await deleteOldestBatch(
      env,
      projectId,
      cutoffIso,
      batchRows
    );
    if (changes === 0) return { rowsDeleted, maxPrunedId, complete: true };
    rowsDeleted += changes;
    maxPrunedId = Math.max(maxPrunedId, ...ids);
  }
}

/**
 * Delete the oldest overflow above the per-project row cap until the project
 * is under the cap (or the budget stops us).
 */
async function pruneByCountCap(
  env: Env,
  budget: StatementBudget,
  projectId: string,
  currentCount: number,
  cap: number,
  batchRows: number
): Promise<PhaseResult> {
  let rowsDeleted = 0;
  let maxPrunedId = 0;
  let count = currentCount;
  for (;;) {
    if (count <= cap) return { rowsDeleted, maxPrunedId, complete: true };
    if (!budget.canSpend(2 + BOOKKEEPING_RESERVE)) {
      return { rowsDeleted, maxPrunedId, complete: false };
    }
    const overflow = Math.min(batchRows, count - cap);
    const ids = await selectOldestIds(env, projectId, null, overflow);
    budget.spend();
    if (ids.length === 0) return { rowsDeleted, maxPrunedId, complete: true };
    budget.spend();
    const changes = await deleteOldestBatch(env, projectId, null, overflow);
    if (changes === 0) return { rowsDeleted, maxPrunedId, complete: true };
    count -= changes;
    rowsDeleted += changes;
    maxPrunedId = Math.max(maxPrunedId, ...ids);
  }
}

/** Oldest-first id read: retention predicate when `cutoffIso` is set. */
async function selectOldestIds(
  env: Env,
  projectId: string,
  cutoffIso: string | null,
  limit: number
): Promise<number[]> {
  const { results } =
    cutoffIso === null
      ? await env.D1_DATABASE.prepare(SELECT_OVERFLOW_BATCH_SQL)
          .bind(projectId, limit)
          .all<{ id: number }>()
      : await env.D1_DATABASE.prepare(SELECT_TIME_BATCH_SQL)
          .bind(projectId, cutoffIso, limit)
          .all<{ id: number }>();
  return results.map((row) => row.id);
}

/** Bounded delete matching the id read (no DELETE ... LIMIT in SQLite/D1). */
async function deleteOldestBatch(
  env: Env,
  projectId: string,
  cutoffIso: string | null,
  limit: number
): Promise<number> {
  const result =
    cutoffIso === null
      ? await env.D1_DATABASE.prepare(DELETE_OVERFLOW_BATCH_SQL)
          .bind(projectId, limit)
          .run()
      : await env.D1_DATABASE.prepare(DELETE_TIME_BATCH_SQL)
          .bind(projectId, cutoffIso, limit)
          .run();
  return result.meta.changes;
}

/**
 * Refresh `project_sync_meta` after a project's rows were deleted:
 * `horizon_created_at` = oldest retained row (the staleness-check horizon),
 * `max_pruned_change_id` = MAX(id) deleted, folded with the historical max
 * (ids are a global AUTOINCREMENT, so it only grows). When the change log was
 * emptied completely the meta row is deleted instead: with zero retained
 * changes there is no delta a lagging client could miss that a snapshot
 * reconcile would not cover.
 */
async function updatePruningMeta(
  env: Env,
  budget: StatementBudget,
  projectId: string,
  maxPrunedId: number,
  nowIso: string
): Promise<{ horizonCreatedAt: string | null; metaDeleted: boolean }> {
  if (!budget.spend(BOOKKEEPING_RESERVE)) {
    // Unreachable while the batch gates hold (they reserve these statements);
    // logged so a silent horizon gap can never go unnoticed.
    console.warn(
      `[changelog-prune] skipping horizon bookkeeping for ${projectId}: statement budget exhausted`
    );
    return { horizonCreatedAt: null, metaDeleted: false };
  }

  const oldest = await env.D1_DATABASE.prepare(OLDEST_RETAINED_SQL)
    .bind(projectId)
    .first<{ created_at: string }>();

  if (!oldest) {
    await env.D1_DATABASE.prepare(DELETE_META_SQL).bind(projectId).run();
    return { horizonCreatedAt: null, metaDeleted: true };
  }

  await env.D1_DATABASE.prepare(UPSERT_META_SQL)
    .bind(projectId, oldest.created_at, maxPrunedId, nowIso)
    .run();
  return { horizonCreatedAt: oldest.created_at, metaDeleted: false };
}
