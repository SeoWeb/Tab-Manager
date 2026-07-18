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
 * A quota-guarded write. `primary` is the statement that *consumes* the quota
 * (creates the project, adds the member, applies the create mutations). It MUST
 * be an `INSERT ... SELECT ... WHERE (count subquery) < limit` so it only
 * commits when capacity is actually available — this is what makes the check
 * concurrency-safe. `dependents` run only after `primary` succeeds and so never
 * orphan rows when the quota is breached.
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
 * When `commit` is supplied, the count and the quota-consuming write are run in
 * a single D1 `batch` (one transaction). Because `primary` is guarded by the
 * live count via its `WHERE` clause, concurrent requests cannot both observe
 * available capacity and overshoot the limit — at most one wins the final slot.
 * The error shape is unchanged (`403` quota-exceeded).
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

  const results = await env.D1_DATABASE.batch([
    commit.primary,
    ...(commit.dependents ?? []),
  ]);

  // The primary statement only inserts when under quota; a 0-row write means
  // the guard tripped and the request must be rejected.
  if ((results[0]?.meta?.changes ?? 0) === 0) {
    return quotaExceeded(breachMessage);
  }
  return null;
}

/**
 * Reject when the user already owns the maximum number of active projects.
 * Returns `null` when within quota, or a `403` `Response`.
 *
 * When `commit` is provided, the project creation is performed atomically with
 * the count check so concurrent creates cannot both pass and overshoot the cap.
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
 * When `commit` is provided, the membership/invitation creation is performed
 * atomically with the count check so concurrent adds cannot overshoot the cap.
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

/**
 * Reject when applying `createCount` new entities would push the project past
 * its total-entity cap. Returns `null` when within quota, or a `403` `Response`.
 *
 * When `commit` is provided, the create-mutation application is performed
 * atomically with the count check so concurrent syncs cannot overshoot the cap.
 */
export async function checkEntityQuotaForMutations(
  env: Env,
  projectId: string,
  createCount: number,
  commit?: QuotaCommit
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  if (createCount <= 0) return null;

  const readSql = `
    SELECT
      (SELECT COUNT(*) FROM collections WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM links WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM notes WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM todos WHERE project_id = ? AND deleted_at IS NULL)
    AS n
  `;

  // When no commit is provided we can decide synchronously from the read.
  if (!commit) {
    const row = await env.D1_DATABASE.prepare(readSql)
      .bind(projectId, projectId, projectId, projectId, projectId)
      .first<{ n: number }>();
    if ((row?.n ?? 0) + createCount > cfg.maxEntitiesPerProject) {
      return quotaExceeded(
        `This project has reached the maximum of ${cfg.maxEntitiesPerProject} entities`
      );
    }
    return null;
  }

  // With a commit the guard lives inside the primary write (each create INSERT
  // carries a `WHERE (existing count + createCount) <= limit` clause), so the
  // count check and the create application run in a single D1 batch. We still
  // re-validate here to keep the error message accurate on the fast path.
  const row = await env.D1_DATABASE.prepare(readSql)
    .bind(projectId, projectId, projectId, projectId, projectId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) + createCount > cfg.maxEntitiesPerProject) {
    return quotaExceeded(
      `This project has reached the maximum of ${cfg.maxEntitiesPerProject} entities`
    );
  }
  return enforceCount(
    env,
    readSql,
    [projectId, projectId, projectId, projectId, projectId],
    cfg.maxEntitiesPerProject,
    `This project has reached the maximum of ${cfg.maxEntitiesPerProject} entities`,
    commit
  );
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
