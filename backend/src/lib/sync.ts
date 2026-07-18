import { badRequest } from './response';
import {
  checkEntityQuotaForMutations,
  checkSyncMutationsPerRequest,
  getQuotaConfig,
} from './quotas';
import { notifyRealtime } from './realtime';
import type {
  Env,
  SyncConflict,
  SyncMutation,
  SyncRequest,
  SyncResponse,
} from '../types';
import {
  type TableKey,
  isObjectRecord,
  nowIso,
  parseCursor,
  parseMutations,
  tableFor,
} from './sync/shared';
import { entityExistsBatch, getEntityVersionBatch } from './sync/queries';
import { buildCreateStatements } from './sync/mutations';
import { applyMutation } from './sync/applyMutation';
import {
  getChangesSince,
  getMaxChangeId,
} from './sync/changelog';

export {
  getChangesSince,
  getLatestChange,
  getMaxChangeId,
} from './sync/changelog';

export async function syncProject(
  env: Env,
  user: { id: string },
  projectId: string,
  body: unknown
): Promise<Response> {
  const { requireProjectAccess } = await import('./projects');
  const access = await requireProjectAccess(env, user.id, projectId, 'editor');
  if (access instanceof Response) return access;

  if (!isObjectRecord(body)) {
    return badRequest('Sync request body must be an object');
  }

  const request = body as SyncRequest;
  const rawMutationCount = Array.isArray(request.mutations)
    ? request.mutations.length
    : 0;
  const mutationCap = checkSyncMutationsPerRequest(
    rawMutationCount,
    getQuotaConfig(env)
  );
  if (mutationCap) return mutationCap;

  const lastCursor = parseCursor(request.lastCursor);
  const mutations = parseMutations(request.mutations);
  const createMutations = mutations.filter((m) => m.operation === 'create');
  const createCount = createMutations.length;

  // Build the shared guard used by every create insert: the project's current
  // entity total plus the incoming creates must stay at or under the cap. The
  // guard is embedded in each create's INSERT so the count check and the writes
  // run inside a single D1 batch (one transaction) and concurrent syncs cannot
  // both observe capacity and overshoot it.
  const maxEntities = getQuotaConfig(env).maxEntitiesPerProject;
  const entityTotalSql = `
    (SELECT COUNT(*) FROM collections WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM links WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM notes WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM todos WHERE project_id = ? AND deleted_at IS NULL)
  `;
  const guardSql = `(${entityTotalSql}) + ? <= ?`;

  // Pre-flight read decision (unchanged error shape). When there are creates we
  // also run the atomic guarded batch below; the read here rejects the obvious
  // over-capacity case up front.
  const entityQuota = await checkEntityQuotaForMutations(
    env,
    projectId,
    createCount
  );
  if (entityQuota) return entityQuota;

  const conflicts: SyncConflict[] = [];

  // Capture the highest existing change id before applying, so we can fan out
  // only the rows this request inserts (Phase 5 realtime).
  const beforeCursor = await getMaxChangeId(env, projectId);

  // Apply the quota-consuming create mutations in a single guarded batch so the
  // count check and the writes are serialized; at most the available capacity
  // is created. Other mutations run through the normal per-mutation path.
  const now = nowIso();

  // Split the create mutations into project-mismatched (immediate conflict) and
  // actionable ones. The existence + version reads for the actionable creates
  // are independent, so fan them out concurrently with Promise.all instead of
  // serializing one read pair per create (avoids the N+1 read latency).
  const actionable: SyncMutation[] = [];
  for (const mutation of createMutations) {
    if (mutation.projectId !== projectId) {
      conflicts.push({
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Mutation project id does not match sync project id',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      });
      continue;
    }
    actionable.push(mutation);
  }

  const existsResults = await entityExistsBatch(
    env,
    actionable.map((m) => ({
      table: tableFor(m.entityType) as TableKey,
      entityId: m.entityId,
    }))
  );
  const versionResults = await getEntityVersionBatch(
    env,
    actionable.map((m) => ({
      projectId: m.projectId,
      entityType: m.entityType,
      entityId: m.entityId,
    }))
  );

  const createStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < actionable.length; i++) {
    const mutation = actionable[i];
    const built = await buildCreateStatements(
      env,
      user.id,
      mutation,
      now,
      guardSql,
      [createCount, maxEntities],
      existsResults[i],
      versionResults[i]
    );
    if ('conflict' in built) {
      conflicts.push(built.conflict);
      continue;
    }
    createStatements.push(...built.statements);
  }

  if (createStatements.length > 0) {
    const primary = createStatements[0];
    const dependents = createStatements.slice(1);
    const breach = await checkEntityQuotaForMutations(
      env,
      projectId,
      createCount,
      {
        primary,
        dependents,
      }
    );
    if (breach) return breach;
  }

  for (const mutation of mutations) {
    if (mutation.operation === 'create') continue; // handled above
    if (mutation.projectId !== projectId) continue;

    const result = await applyMutation(env, user.id, mutation);
    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }

  const changes = await getChangesSince(env, projectId, lastCursor);
  const cursor = changes.at(-1)?.id ?? lastCursor ?? 0;

  // Push the changes committed by this request to any member currently viewing
  // the project over a realtime socket. Best-effort; never fails the sync.
  const inserted =
    beforeCursor === null
      ? changes
      : changes.filter((c) => c.id > beforeCursor);
  await notifyRealtime(env, projectId, inserted);

  const response: SyncResponse = {
    cursor,
    changes,
    conflicts,
  };

  return Response.json(response);
}

export { applyMutation } from './sync/applyMutation';
export { describeMoveFanOut } from './sync/moveFanOut';
export type { ChangeLogRow } from './sync/moveFanOut';

