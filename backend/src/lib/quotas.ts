import { badRequest, quotaExceeded } from './response';
import type { Env } from '../types';

export interface QuotaConfig {
  maxProjectsPerUser: number;
  maxMembersPerProject: number;
  maxEntitiesPerProject: number;
  maxSyncMutationsPerRequest: number;
}

function parseOverride(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the usage-quota limits from env overrides, falling back to safe
 * defaults when unset or invalid.
 */
export function getQuotaConfig(env: Env): QuotaConfig {
  return {
    maxProjectsPerUser: parseOverride(env.QUOTA_MAX_PROJECTS_PER_USER, 10),
    maxMembersPerProject: parseOverride(env.QUOTA_MAX_MEMBERS_PER_PROJECT, 50),
    maxEntitiesPerProject: parseOverride(
      env.QUOTA_MAX_ENTITIES_PER_PROJECT,
      5000
    ),
    maxSyncMutationsPerRequest: parseOverride(
      env.QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST,
      200
    ),
  };
}

/**
 * A quota-guarded write, executed in TWO PHASES.
 *
 * `primary` is the statement that *consumes* the quota (creates the project,
 * adds the member). It MUST be an `INSERT ... SELECT ... WHERE (count subquery)
 * < limit` so it only commits when capacity is actually available — this is
 * what makes the check concurrency-safe.
 *
 * `dependents` run as a SEPARATE second batch, only after the primary is known
 * to have committed. They must never ride in the same batch as the guard: D1
 * batches execute every statement even when an earlier statement inserts 0
 * rows, so a guard that trips would still commit the dependents — orphaned
 * memberships for projects that were never created, invitations marked
 * accepted without a membership, phantom version bumps and changelog rows.
 */
export interface QuotaCommit {
  primary: D1PreparedStatement;
  dependents?: D1PreparedStatement[];
}

/**
 * Enforce a count-based quota atomically.
 *
 * When no `commit` is supplied the quota is a plain read check (used where the
 * caller performs the write itself and only needs the pre-flight decision).
 *
 * When `commit` is supplied the check runs in two phases. Phase 1 executes the
 * guarded `primary` statement ALONE: because the guard lives in its `WHERE`
 * clause, the check-and-insert is still atomic and concurrent requests cannot
 * both observe available capacity and overshoot the limit — at most one wins
 * the final slot. A 0-row result means the quota is exhausted and the
 * structured `403` is returned WITHOUT any dependent statement having run.
 * Phase 2 executes the dependents only once the primary write has definitely
 * committed, so dependents can never orphan. The error shape is unchanged
 * (`403` quota-exceeded).
 */
async function enforceCount(
  env: Env,
  readSql: string,
  readArgs: unknown[],
  limit: number,
  breachMessage: string,
  commit?: QuotaCommit
): Promise<Response | null> {
  if (!commit) {
    const row = await env.D1_DATABASE.prepare(readSql)
      .bind(...readArgs)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= limit) {
      return quotaExceeded(breachMessage);
    }
    return null;
  }

  // Phase 1: the quota-consuming write alone.
  const results = await env.D1_DATABASE.batch([commit.primary]);

  // The primary statement only inserts when under quota; a 0-row write means
  // the guard tripped and the request must be rejected before ANY dependent
  // statement executes.
  if ((results[0]?.meta?.changes ?? 0) === 0) {
    return quotaExceeded(breachMessage);
  }

  // Phase 2: dependents run only after the primary has committed.
  if (commit.dependents && commit.dependents.length > 0) {
    await env.D1_DATABASE.batch(commit.dependents);
  }
  return null;
}

/**
 * Reject when the user already owns the maximum number of active projects.
 * Returns `null` when within quota, or a `403` `Response`.
 *
 * When `commit` is provided, the project creation is performed atomically with
 * the count check (guarded primary statement, then dependents in a second
 * batch — see `QuotaCommit`) so concurrent creates cannot both pass and
 * overshoot the cap.
 */
export async function checkProjectQuota(
  env: Env,
  userId: string,
  commit?: QuotaCommit
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  const readSql =
    'SELECT COUNT(*) AS n FROM projects WHERE owner_id = ? AND deleted_at IS NULL';
  return enforceCount(
    env,
    readSql,
    [userId],
    cfg.maxProjectsPerUser,
    `You have reached the maximum of ${cfg.maxProjectsPerUser} projects`,
    commit
  );
}

/**
 * Reject when the project already has the maximum number of members. Returns
 * `null` when within quota, or a `403` `Response`.
 *
 * When `commit` is provided, the membership creation is performed atomically
 * with the count check (guarded primary statement, then dependents such as the
 * invitation's `accepted_at` update in a second batch — see `QuotaCommit`) so
 * concurrent accepts cannot overshoot the cap.
 */
export async function checkMemberQuota(
  env: Env,
  projectId: string,
  commit?: QuotaCommit
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  const readSql =
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?';
  return enforceCount(
    env,
    readSql,
    [projectId],
    cfg.maxMembersPerProject,
    `This project has reached the maximum of ${cfg.maxMembersPerProject} members`,
    commit
  );
}

/** Shared live-entity count read (collections + links + tasks + notes + todos). */
const ENTITY_COUNT_READ_SQL = `
  SELECT
    (SELECT COUNT(*) FROM collections WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM links WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM notes WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM todos WHERE project_id = ? AND deleted_at IS NULL)
  AS n
`;

/** The fixed client-visible message for an entity-quota breach. */
export function entityQuotaMessage(cfg: QuotaConfig): string {
  return `This project has reached the maximum of ${cfg.maxEntitiesPerProject} entities`;
}

/**
 * How many new entities the project can still accept before hitting its
 * total-entity cap (never negative). The sync path reads this up front, applies
 * creates in request order until it runs out, and rejects the overflow with a
 * structured `403` — creates applied within capacity stay committed, blocked
 * creates leave no version bump and no changelog row.
 */
export async function getEntityQuotaHeadroom(
  env: Env,
  projectId: string
): Promise<number> {
  const cfg = getQuotaConfig(env);
  const row = await env.D1_DATABASE.prepare(ENTITY_COUNT_READ_SQL)
    .bind(projectId, projectId, projectId, projectId, projectId)
    .first<{ n: number }>();
  return Math.max(0, cfg.maxEntitiesPerProject - (row?.n ?? 0));
}

/**
 * Reject a sync request carrying more than the configured mutation cap. Returns
 * `null` within the cap, or a `400` `Response` (abuse, not a provisioned quota).
 */
export function checkSyncMutationsPerRequest(
  count: number,
  cfg: QuotaConfig
): Response | null {
  if (count > cfg.maxSyncMutationsPerRequest) {
    return badRequest(
      `Sync request exceeds the maximum of ${cfg.maxSyncMutationsPerRequest} mutations`
    );
  }
  return null;
}
