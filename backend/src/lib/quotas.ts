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
 * Reject when the user already owns the maximum number of active projects.
 * Returns `null` when within quota, or a `403` `Response`.
 */
export async function checkProjectQuota(
  env: Env,
  userId: string
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  const row = await env.D1_DATABASE.prepare(
    'SELECT COUNT(*) AS n FROM projects WHERE owner_id = ? AND deleted_at IS NULL'
  )
    .bind(userId)
    .first<{ n: number }>();

  const count = row?.n ?? 0;
  if (count >= cfg.maxProjectsPerUser) {
    return quotaExceeded(
      `You have reached the maximum of ${cfg.maxProjectsPerUser} projects`
    );
  }
  return null;
}

/**
 * Reject when the project already has the maximum number of members. Returns
 * `null` when within quota, or a `403` `Response`.
 */
export async function checkMemberQuota(
  env: Env,
  projectId: string
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  const row = await env.D1_DATABASE.prepare(
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?'
  )
    .bind(projectId)
    .first<{ n: number }>();

  const count = row?.n ?? 0;
  if (count >= cfg.maxMembersPerProject) {
    return quotaExceeded(
      `This project has reached the maximum of ${cfg.maxMembersPerProject} members`
    );
  }
  return null;
}

/**
 * Reject when applying `createCount` new entities would push the project past
 * its total-entity cap. Returns `null` when within quota, or a `403` `Response`.
 */
export async function checkEntityQuotaForMutations(
  env: Env,
  projectId: string,
  createCount: number
): Promise<Response | null> {
  const cfg = getQuotaConfig(env);
  if (createCount <= 0) return null;

  const row = await env.D1_DATABASE.prepare(
    `
    SELECT
      (SELECT COUNT(*) FROM collections WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM links WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM notes WHERE project_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM todos WHERE project_id = ? AND deleted_at IS NULL)
    AS n
    `
  )
    .bind(projectId, projectId, projectId, projectId, projectId)
    .first<{ n: number }>();

  const count = row?.n ?? 0;
  if (count + createCount > cfg.maxEntitiesPerProject) {
    return quotaExceeded(
      `This project has reached the maximum of ${cfg.maxEntitiesPerProject} entities`
    );
  }
  return null;
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
