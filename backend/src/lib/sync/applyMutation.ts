import type { Env, SyncConflict, SyncMutation } from '../../types';
import {
  type ApplyMutationResult,
  MutationPatchError,
  entityNotFoundConflict,
  jsonTableFor,
  nowIso,
  tableFor,
} from './shared';
import { prepareEntityExistsStatement, prepareMutationDedupeStatement } from './queries';
import {
  applyProjectMutation,
  buildEntityStatement,
  commitEntityBatch,
  invalidPatchConflict,
} from './mutations';
import { describeMoveFanOut } from './moveFanOut';
import { isUniqueMutationIdViolation } from './statements/changelog';

/**
 * Apply a single client mutation idempotently and project-scoped.
 *
 * Security invariants (change `secure-sync-backend`):
 * - every existence/version/row read filters on the mutation's project, and
 *   every UPDATE/DELETE carries `AND project_id = ?` — a caller authorized for
 *   project A can never read or write an entity of project B. A foreign id is
 *   indistinguishable from a nonexistent one (not-found conflict);
 * - `project_id` is never in an UPDATE set-list, so a mutation can never move
 *   an entity across projects;
 * - UPDATE mutations require `baseVersion`: the entity write, the change-log
 *   row(s) and the version bump all carry a `version = baseVersion` guard
 *   committed in one D1 batch (CAS), so a lost race changes nothing;
 * - a UNIQUE violation on sync_changes (migration 0004) is a replay that raced
 *   past the pre-check and maps to an idempotent success.
 */
export async function applyMutation(
  env: Env,
  actorId: string,
  mutation: SyncMutation
): Promise<ApplyMutationResult> {
  // Idempotency pre-check, scoped to the mutation's project — matching the
  // UNIQUE(project_id, client_mutation_id) index from migration 0004. The same
  // client mutation id in a DIFFERENT project is a distinct mutation. This
  // read and the presence check below are independent, so they fold into ONE
  // batched round-trip (per-statement results arrive in order) instead of two
  // sequential reads. The move-detection read further down stays separate: it
  // depends on presence having passed.
  const table = tableFor(mutation.entityType);
  const needsPresence =
    table !== null &&
    mutation.operation !== 'create' &&
    mutation.entityType !== 'project';

  const dedupeStmt = prepareMutationDedupeStatement(env, mutation);

  const readResults = (await env.D1_DATABASE.batch(
    needsPresence && table
      ? [
          dedupeStmt,
          prepareEntityExistsStatement(
            env,
            table,
            mutation.entityId,
            mutation.projectId
          ),
        ]
      : [dedupeStmt]
  )) as { results?: unknown[] }[];

  // A replayed (project, clientMutationId) is an idempotent success: nothing
  // further to read or write.
  if ((readResults[0]?.results ?? []).length > 0) {
    return {};
  }

  if (!table) {
    return {
      conflict: {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Unsupported entity type',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      },
    };
  }

  // Presence is resolved on the live basis BEFORE the version guard so an
  // update/delete targeting a tombstone — or an entity of another project —
  // always yields a clean "not found" conflict with zero writes. Projects are
  // resolved inside applyProjectMutation.
  if (needsPresence) {
    const exists = (readResults[1]?.results ?? []).length > 0;
    if (!exists) {
      return { conflict: entityNotFoundConflict(mutation, 0) };
    }
  }

  // Mandatory CAS basis for updates (non-project; project updates enforce this
  // inside applyProjectMutation after their existence checks). A missing
  // baseVersion is a per-mutation bad-mutation outcome — never applied, and
  // never defaulted to 0.
  if (
    mutation.operation === 'update' &&
    mutation.entityType !== 'project' &&
    mutation.baseVersion === undefined
  ) {
    return { skipped: { reason: 'missing_base_version' } };
  }

  const now = nowIso();

  if (mutation.entityType === 'project') {
    return applyProjectMutation(env, actorId, mutation, now);
  }

  let built:
    | { stmt: D1PreparedStatement }
    | { conflict: SyncConflict };
  try {
    built = await buildEntityStatement(env, table, mutation, now);
  } catch (error) {
    // Only the engine's own invalid-patch signals (MutationPatchError) become
    // conflicts (with a fixed, client-safe message). D1 failures and any other
    // exception propagate to the top-level handler (500 + retryable) rather
    // than being converted into a conflict that could leak SQL or constraint
    // text.
    if (!(error instanceof MutationPatchError)) throw error;
    return { conflict: invalidPatchConflict(mutation, 0) };
  }
  if ('conflict' in built) return { conflict: built.conflict };
  const entityStmt = built.stmt;

  // Cross-project move detection (task/note/todo only). Read the entity's
  // current project — scoped, so only an entity of THIS project can be found.
  // After the scoping above this equals the mutation's project for any applied
  // mutation, so moves are effectively unreachable; the read keeps the fan-out
  // wiring correct and harmless.
  let existingProjectId: string | null = null;
  if (mutation.operation === 'update') {
    const jsonTable = jsonTableFor(mutation.entityType);
    if (jsonTable) {
      const row = await env.D1_DATABASE.prepare(
        `SELECT project_id FROM ${jsonTable} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
      )
        .bind(mutation.entityId, mutation.projectId)
        .first<{ project_id: string | null }>();
      existingProjectId = row?.project_id ?? null;
    }
  }
  const fanOut = describeMoveFanOut(
    mutation.entityType,
    mutation.operation,
    existingProjectId,
    mutation
  );

  // No catch here on purpose beyond the replay mapping inside
  // commitEntityBatch: every conflict condition was already resolved above.
  // A batch failure at this point is infrastructure (D1 outage, constraint
  // violation) and must propagate to the top-level handler, which logs it and
  // answers `500 retryable` — never a 200 with a fake conflict.
  return commitEntityBatch(
    env,
    actorId,
    mutation,
    now,
    entityStmt,
    fanOut,
    mutation.baseVersion
  );
}
