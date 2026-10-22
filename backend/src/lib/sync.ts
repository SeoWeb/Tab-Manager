import { badRequest, quotaExceeded } from './response';
import { parseBody, syncPayloadSchema } from './validation';
import {
  entityQuotaMessage,
  getEntityQuotaHeadroom,
  getQuotaConfig,
  checkSyncMutationsPerRequest,
} from './quotas';
import { notifyRealtime } from './realtime';
import type {
  Env,
  SyncConflict,
  SyncMutation,
  SyncMutationOutcome,
  SyncResponse,
} from '../types';
import {
  type TableKey,
  isObjectRecord,
  isValidMutation,
  nowIso,
  parseCursor,
  tableFor,
} from './sync/shared';
import { entityExistsBatch, getEntityVersionBatch } from './sync/queries';
import { buildCreateStatements } from './sync/mutations';
import { applyMutation } from './sync/applyMutation';
import {
  applyBatchedMutations,
  type BatchedEntry,
} from './sync/batched';
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
  body: unknown,
  /**
   * Worker execution context. When supplied, realtime fan-out is scheduled via
   * `ctx.waitUntil` so a slow or failed notification cannot delay or fail the
   * sync response. Optional so existing callers (unit tests) keep working via
   * a best-effort awaited fallback.
   */
  ctx?: ExecutionContext
): Promise<Response> {
  const { requireProjectAccess } = await import('./projects');
  const access = await requireProjectAccess(env, user.id, projectId, 'editor');
  if (access instanceof Response) return access;

  if (!isObjectRecord(body)) {
    return badRequest('Sync request body must be an object');
  }

  // Envelope-level validation only: the mutations array is bounded and each
  // entry must carry a `clientMutationId`. Per-mutation field validation stays
  // with the sync engine (`isValidMutation` / per-mutation outcomes).
  const envelope = parseBody(syncPayloadSchema, body);
  if (!envelope.ok) {
    return badRequest('Invalid request', envelope.details);
  }
  const request = envelope.data;
  const rawMutations = request.mutations ?? [];
  const rawMutationCount = rawMutations.length;
  const mutationCap = checkSyncMutationsPerRequest(
    rawMutationCount,
    getQuotaConfig(env)
  );
  if (mutationCap) return mutationCap;

  const lastCursor = parseCursor(request.lastCursor);

  // Lagging-client detection (scale-sync-backend, change-log-retention): one
  // indexed PK read per request. A client is STALE iff
  //   a `project_sync_meta` row exists for the project (never pruned ⇒ no row
  //   ⇒ never stale) AND the request carried a non-empty `lastCursor`
  //   (initial sync pulls from scratch anyway) AND
  //   lastCursor < max_pruned_change_id (the cursor points into pruned
  //   history — sync_changes ids are a global AUTOINCREMENT and pruning
  //   deletes oldest-first, so any retained id exceeds every pruned one).
  // The flag is computed up front but only consumed at response assembly
  // below, so mutation application is unaffected: CAS baseVersions protect
  // correctness either way and the outcomes stay real.
  let reconcileRequired = false;
  if (lastCursor !== null) {
    const meta = await env.D1_DATABASE.prepare(
      'SELECT max_pruned_change_id FROM project_sync_meta WHERE project_id = ?'
    )
      .bind(projectId)
      .first<{ max_pruned_change_id: number }>();
    if (meta && lastCursor < meta.max_pruned_change_id) {
      reconcileRequired = true;
    }
  }

  // Per-entry parsing. EVERY submitted mutation — including entries that fail
  // per-mutation validation or target another project — produces exactly one
  // outcome, positionally aligned with the request. Nothing is silently
  // dropped.
  const parsed: (SyncMutation | null)[] = rawMutations.map((m) =>
    isValidMutation(m) ? m : null
  );
  const createIdx: number[] = [];
  const otherIdx: number[] = [];
  parsed.forEach((m, i) => {
    if (!m) return;
    if (m.operation === 'create') createIdx.push(i);
    else otherIdx.push(i);
  });
  const createCount = createIdx.length;

  // Build the shared guard used by every create insert: the insert only
  // commits while the project's live entity total is still under the cap.
  // The guard is per-create (`total + 1 <= max`): each insert consumes exactly
  // one slot at execution time, so concurrent syncs cannot both observe
  // capacity and overshoot it.
  const maxEntities = getQuotaConfig(env).maxEntitiesPerProject;
  const entityTotalSql = `
    (SELECT COUNT(*) FROM collections WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM links WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM notes WHERE project_id = ? AND deleted_at IS NULL) +
    (SELECT COUNT(*) FROM todos WHERE project_id = ? AND deleted_at IS NULL)
  `;
  const guardSql = `(${entityTotalSql}) + ? <= ?`;

  // Remaining capacity, read up front. Creates are attempted in request order
  // until it runs out; the overflow is rejected with a structured 403 at the
  // end of the create pass (creates applied within capacity stay committed —
  // the 403 only refuses the excess).
  const headroom =
    createCount > 0 ? await getEntityQuotaHeadroom(env, projectId) : 0;

  const conflicts: SyncConflict[] = [];
  const outcomes: (SyncMutationOutcome | undefined)[] = new Array(
    rawMutations.length
  );

  // Entries that failed per-mutation validation: skipped, machine-readable.
  parsed.forEach((m, i) => {
    if (m) return;
    const raw = rawMutations[i] as { clientMutationId?: string };
    outcomes[i] = {
      clientMutationId: String(raw.clientMutationId ?? ''),
      status: 'skipped',
      reason: 'invalid_mutation',
    };
  });

  // Capture the highest existing change id before applying, so we can fan out
  // only the rows this request inserts (Phase 5 realtime).
  const beforeCursor = await getMaxChangeId(env, projectId);

  // Apply the quota-consuming create mutations through a two-phase commit
  // (guarded INSERT alone, then its dependents), bounded by the remaining
  // capacity. Other mutations run through the normal per-mutation path.
  const now = nowIso();

  // Creates whose `projectId` does not match the sync route's project are
  // never applied: they keep their legacy conflict entry (compat) and get an
  // explicit `project_mismatch` skip outcome.
  const actionable: { mutation: SyncMutation; idx: number }[] = [];
  for (const idx of createIdx) {
    const mutation = parsed[idx] as SyncMutation;
    if (mutation.projectId !== projectId) {
      conflicts.push({
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Mutation project id does not match sync project id',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      });
      outcomes[idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'skipped',
        reason: 'project_mismatch',
      };
      continue;
    }
    actionable.push({ mutation, idx });
  }

  // Existence + version reads for the actionable creates are project-scoped
  // and independent, so fan them out concurrently with Promise.all instead of
  // serializing one read pair per create (avoids the N+1 read latency).
  const existsResults = await entityExistsBatch(
    env,
    actionable.map(({ mutation }) => ({
      table: tableFor(mutation.entityType) as TableKey,
      entityId: mutation.entityId,
      projectId: mutation.projectId,
    }))
  );
  const versionResults = await getEntityVersionBatch(
    env,
    actionable.map(({ mutation }) => ({
      projectId: mutation.projectId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
    }))
  );

  // Build each create's statement group ([INSERT, version bump, changelog
  // row]). Only the BOUNDARY create — the headroom-th materialized group,
  // i.e. the create that would exactly consume the final pre-read slot —
  // embeds the quota guard in its INSERT. Earlier creates are plain INSERTs:
  // the `appliedCreates >= headroom` loop bound below already prevents this
  // request from overshooting the pre-read capacity, so re-counting per
  // insert would only repeat work. The boundary guard still atomically
  // re-validates LIVE capacity at execution time, so a concurrent sync that
  // consumed a slot since the headroom read loses the race there (0 changes ⇒
  // structured 403, no version bump, no changelog row). No outcome is
  // assigned here — the create counts as `applied` only once its INSERT has
  // actually committed below.
  const createGroups: {
    idx: number;
    clientMutationId: string;
    mutation: SyncMutation;
    exists: boolean;
    currentVersion: number;
    statements: D1PreparedStatement[];
  }[] = [];
  let materializedGroups = 0;
  for (let i = 0; i < actionable.length; i++) {
    const { mutation, idx } = actionable[i];
    const isBoundary = materializedGroups === headroom - 1;
    const built = await buildCreateStatements(
      env,
      user.id,
      mutation,
      now,
      isBoundary ? guardSql : undefined,
      isBoundary ? [1, maxEntities] : undefined,
      existsResults[i],
      versionResults[i]
    );
    if ('conflict' in built) {
      conflicts.push(built.conflict);
      outcomes[idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'conflict',
        message: built.conflict.message,
      };
      continue;
    }
    if ('alreadyApplied' in built) {
      // Resubmission of an already-committed create (migration 0004 replay
      // key): idempotent success, nothing further to write. Consumes no
      // capacity, so it succeeds even when the project is at its entity cap.
      outcomes[idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      };
      continue;
    }
    createGroups.push({
      idx,
      clientMutationId: mutation.clientMutationId,
      mutation,
      exists: existsResults[i] ?? false,
      currentVersion: versionResults[i] ?? 0,
      statements: built.statements,
    });
    materializedGroups++;
  }

  // Conflicts and replays consume no capacity, so fewer groups can materialize
  // than the pre-read headroom — in that case the headroom-th create never
  // exists and the LAST materialized group is the boundary create (the last
  // one the commit loop will attempt). Rebuild it with the guard so live
  // capacity is still re-validated atomically at execution time. If the
  // rebuild disagrees with the first build (a concurrent request committed the
  // same entity/mutation in between), keep the original statements: their
  // INSERT then fails on the entity UNIQUE constraint and rolls back — the
  // same no-trace outcome the pre-existing race produced.
  if (materializedGroups > 0 && materializedGroups < headroom) {
    const boundary = createGroups[materializedGroups - 1];
    const rebuilt = await buildCreateStatements(
      env,
      user.id,
      boundary.mutation,
      now,
      guardSql,
      [1, maxEntities],
      boundary.exists,
      boundary.currentVersion
    );
    if ('statements' in rebuilt) {
      boundary.statements = rebuilt.statements;
    }
  }

  // Two-phase commit for the quota-consuming creates. Phase 1 runs the
  // INSERT(s) ALONE — for the boundary create it is the quota-guarded
  // statement: a 0-row result means the capacity read above was consumed by a
  // concurrent sync (or was already stale), and the request is rejected with a
  // structured 403 WITHOUT writing the version bump or changelog row — a
  // blocked create leaves no trace. Phase 2 runs the dependents only after the
  // entity row is known to exist, so every applied create is durably
  // accompanied by its changelog row and version bump. Earlier creates need no
  // guard: the headroom bound refuses to attempt them once the pre-read
  // capacity is used up.
  //
  // The serial kill-switch keeps the pre-batching per-create loop (one
  // phase-1 batch + one phase-2 batch per create). The default batched path
  // runs the SAME statements in the SAME order, grouped: phase 1 is one batch
  // of every INSERT the cached headroom still admits, phase 2 is one batch of
  // exactly those inserts' dependents (statements run sequentially inside a
  // batch, so the boundary guard still re-counts the inserts committed before
  // it). A 0-changes INSERT stops phase 2 at that point — already-committed
  // inserts of the batch keep their dependents written, matching the loop's
  // break semantics — and the structured 403 below refuses the rest.
  let quotaBreached = false;

  const commitCreatesSerial = async (): Promise<void> => {
    let appliedCreates = 0;
    for (const group of createGroups) {
      if (appliedCreates >= headroom) {
        // Out of (pre-read) capacity: this and every remaining create are
        // overflow. Stop here; the 403 below refuses them.
        quotaBreached = true;
        break;
      }
      const [primary, ...dependents] = group.statements;
      const results = await env.D1_DATABASE.batch([primary]);
      if ((results[0]?.meta?.changes ?? 0) === 0) {
        // Lost the capacity race: reject before any dependent statement runs.
        quotaBreached = true;
        break;
      }
      if (dependents.length > 0) {
        await env.D1_DATABASE.batch(dependents);
      }
      appliedCreates++;
      outcomes[group.idx] = {
        clientMutationId: group.clientMutationId,
        status: 'applied',
      };
    }
  };

  const commitCreatesBatched = async (): Promise<void> => {
    const attemptCount = Math.min(createGroups.length, headroom);
    if (createGroups.length > headroom) {
      // The loop bound would have refused these before ever attempting them.
      quotaBreached = true;
    }
    let committedCount = attemptCount;
    if (attemptCount > 0) {
      const primaries = createGroups
        .slice(0, attemptCount)
        .map((group) => group.statements[0] as D1PreparedStatement);
      const results = (await env.D1_DATABASE.batch(
        primaries
      )) as { meta?: { changes?: number } }[];
      const firstMiss = results.findIndex(
        (r) => (r?.meta?.changes ?? 0) === 0
      );
      if (firstMiss !== -1) {
        // Lost the capacity race at the boundary guard: no dependent of this
        // or any later create runs.
        quotaBreached = true;
        committedCount = firstMiss;
      }
    }
    const committedGroups = createGroups.slice(0, committedCount);
    const dependents = committedGroups.flatMap(
      (group) => group.statements.slice(1)
    );
    if (dependents.length > 0) {
      await env.D1_DATABASE.batch(dependents);
    }
    for (const group of committedGroups) {
      outcomes[group.idx] = {
        clientMutationId: group.clientMutationId,
        status: 'applied',
      };
    }
  };

  if (env.SYNC_SERIAL_MODE === '1') {
    await commitCreatesSerial();
  } else {
    await commitCreatesBatched();
  }

  // Overflow: the whole sync request is answered 403 so the client keeps the
  // blocked creates queued (its outcome handling retries them later); the
  // creates applied within capacity are already committed durably. Non-create
  // mutations in this request are not applied, matching the previous
  // breach-aborts-the-request behavior.
  if (quotaBreached) {
    return quotaExceeded(entityQuotaMessage(getQuotaConfig(env)));
  }

  // Non-create mutations: engine-applied with a full project-scoped CAS. A
  // mutation claiming another project is skipped with a machine-readable
  // `project_mismatch` reason (previously a silent `continue`).
  //
  // Dependency classification (scale-sync-backend): mutations that touch the
  // same entity within one request are DEPENDENT and must apply in submission
  // order, so every such subgroup — plus project mutations and updates on
  // entities created earlier in THIS request (their existence/version basis
  // only materializes through the create pass) — stays on the serial
  // `applyMutation` path. Everything else (distinct entities, one mutation
  // each) is pairwise independent and goes through the batched apply path.
  // Within either path each submitted mutation still produces exactly one
  // positionally-aligned outcome.
  const createdInRequest = new Set<string>();
  for (const m of parsed) {
    if (m?.operation === 'create') {
      createdInRequest.add(`${m.entityType}\u0000${m.entityId}`);
    }
  }

  const serialEntries: BatchedEntry[] = [];
  const batchedEntries: BatchedEntry[] = [];
  {
    const perEntity = new Map<string, number[]>();
    for (const idx of otherIdx) {
      const mutation = parsed[idx] as SyncMutation;
      if (mutation.projectId !== projectId) {
        outcomes[idx] = {
          clientMutationId: mutation.clientMutationId,
          status: 'skipped',
          reason: 'project_mismatch',
        };
        continue;
      }
      if (
        mutation.entityType === 'project' ||
        createdInRequest.has(`${mutation.entityType}\u0000${mutation.entityId}`)
      ) {
        serialEntries.push({ idx, mutation });
        continue;
      }
      const key = `${mutation.entityType}\u0000${mutation.entityId}`;
      const indices = perEntity.get(key);
      if (indices) indices.push(idx);
      else perEntity.set(key, [idx]);
    }
    for (const indices of perEntity.values()) {
      if (indices.length > 1) {
        // Dependent subgroup (e.g. update-then-delete, or two updates, on the
        // same entity): serial, in submission order.
        for (const idx of indices) {
          serialEntries.push({ idx, mutation: parsed[idx] as SyncMutation });
        }
      } else {
        const idx = indices[0] as number;
        batchedEntries.push({ idx, mutation: parsed[idx] as SyncMutation });
      }
    }
    serialEntries.sort((a, b) => a.idx - b.idx);
  }

  const applySerialEntries = async (entries: BatchedEntry[]) => {
    for (const { idx, mutation } of entries) {
      const result = await applyMutation(env, user.id, mutation);
      if (result.conflict) {
        conflicts.push(result.conflict);
        outcomes[idx] = {
          clientMutationId: mutation.clientMutationId,
          status: 'conflict',
          message: result.conflict.message,
        };
      } else if (result.skipped) {
        outcomes[idx] = {
          clientMutationId: mutation.clientMutationId,
          status: 'skipped',
          reason: result.skipped.reason,
        };
      } else {
        outcomes[idx] = {
          clientMutationId: mutation.clientMutationId,
          status: 'applied',
        };
      }
    }
  };

  if (env.SYNC_SERIAL_MODE === '1') {
    // Kill-switch: the whole non-create path through the pre-batching serial
    // engine, in submission order.
    const all: BatchedEntry[] = [];
    for (const idx of otherIdx) {
      const mutation = parsed[idx] as SyncMutation;
      if (mutation.projectId !== projectId) continue; // already given an outcome above
      all.push({ idx, mutation });
    }
    await applySerialEntries(all);
  } else {
    await applySerialEntries(serialEntries);
    if (batchedEntries.length > 0) {
      await applyBatchedMutations(
        env,
        user.id,
        batchedEntries,
        outcomes,
        conflicts
      );
    }
  }

  // Delta read for the client + realtime fan-out. When the client is stale we
  // skip the cursor-scoped delta entirely — it would span the pruned window
  // (incomplete under its LIMIT, and expensive) — and answer `changes: []`
  // below; the flagged client converges via the snapshot endpoint instead.
  // The fan-out still needs the rows THIS request committed, so the same read
  // is scoped to `beforeCursor` instead: bounded by this request's own
  // mutations, never by the pruned gap.
  const changes = await getChangesSince(
    env,
    projectId,
    reconcileRequired ? beforeCursor : lastCursor
  );
  const cursor = reconcileRequired
    ? // Fresh max change id for the project (post-apply): a sane value beats
      // the stale one. The flagged client reconciles from the snapshot and
      // resumes incremental pulls from here; because this cursor sits at or
      // above max_pruned_change_id, the next sync cannot re-trigger the flag
      // for the same pruned horizon.
      ((await getMaxChangeId(env, projectId)) ?? lastCursor ?? 0)
    : (changes.at(-1)?.id ?? lastCursor ?? 0);

  // Push the changes committed by this request to any member currently viewing
  // the project over a realtime socket. Best-effort; never fails the sync.
  // (On the stale path the scoped read above already starts at beforeCursor,
  // so the filter is a no-op there.)
  const inserted =
    beforeCursor === null
      ? changes
      : changes.filter((c) => c.id > beforeCursor);
  // Realtime fan-out runs OFF the request path: with an execution context the
  // notification is scheduled via `ctx.waitUntil`, so a slow or hung project
  // room cannot delay the response (and a failure is only logged). Without a
  // context (unit tests, other callers) fall back to a best-effort awaited
  // notify with the same never-fail contract.
  const notify = notifyRealtime(env, projectId, inserted);
  if (ctx) {
    ctx.waitUntil(
      notify.catch((error) =>
        console.error('[sync] realtime notify failed', error)
      )
    );
  } else {
    try {
      await notify;
    } catch (error) {
      console.error('[sync] realtime notify failed', error);
    }
  }

  const response: SyncResponse = {
    cursor,
    // Stale client: empty BY DESIGN (see the lagging-client detection above) —
    // the client is directed to a snapshot reconcile via `reconcileRequired`.
    changes: reconcileRequired ? [] : changes,
    conflicts,
    outcomes: outcomes.map(
      (o, i) =>
        o ?? {
          clientMutationId: String(
            (rawMutations[i] as { clientMutationId?: string }).clientMutationId ??
              ''
          ),
          status: 'error' as const,
        }
    ),
    // Only set on the stale path: a healthy response stays byte-identical to
    // the pre-flag wire format.
    ...(reconcileRequired ? { reconcileRequired: true } : {}),
  };

  return Response.json(response);
}

export { applyMutation } from './sync/applyMutation';
export { describeMoveFanOut } from './sync/moveFanOut';
export type { ChangeLogRow } from './sync/moveFanOut';
