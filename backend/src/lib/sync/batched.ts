import type { Env, SyncConflict, SyncMutation, SyncMutationOutcome } from '../../types';
import {
  type TableKey,
  MutationPatchError,
  entityNotFoundConflict,
  nowIso,
  tableFor,
  versionConflict,
} from './shared';
import {
  prepareEntityExistsStatement,
  prepareMutationDedupeStatement,
} from './queries';
import {
  prepareCasIncrementVersion,
  prepareIncrementVersion,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
  prepareReadEntityRow,
  prepareReadEntityVersion,
  prepareSoftDelete,
  prepareUpdateFromRow,
  isUniqueMutationIdViolation,
} from './statements';
import { describeMoveFanOut } from './moveFanOut';
import { invalidPatchConflict } from './mutations';
import { applyMutation } from './applyMutation';

/**
 * Batched application of INDEPENDENT non-create mutations (change
 * `scale-sync-backend`, decision "Group mutations into independent batches by
 * dependency class").
 *
 * The caller (sync.ts) has already classified the request's non-create
 * mutations and guarantees every entry here targets a DISTINCT entity — no two
 * entries share (entityType, entityId), none is a project mutation, and no
 * entry's entity was created earlier in the same request. Those cases stay on
 * the serial `applyMutation` path in submission order.
 *
 * Round-trip shape:
 * - ONE pre-batch read per group: the per-mutation idempotency dedupe,
 *   project-scoped existence, and (updates) current-row merge reads, folded
 *   into shared D1 batch chunks (extends the 2.3 fold pattern);
 * - ONE write sequence: per mutation, in submission order, exactly the
 *   statement block `commitEntityBatch` builds — [in-batch version read],
 *   entity write, change-log insert(s), version bump — chunked into shared D1
 *   batches without ever splitting a mutation's block.
 *
 * Per-mutation outcome mapping is exact:
 * - replayed (project, clientMutationId) (dedupe hit) → idempotent `applied`,
 *   excluded from the write batch entirely;
 * - existence miss → the not-found conflict, no statements written;
 * - update without `baseVersion` → `skipped missing_base_version`;
 * - `MutationPatchError` while merging → the fixed invalid-patch conflict;
 * - CAS miss → `conflict` for THAT mutation only: the entity write, the
 *   change-log insert and the version bump all carry the same
 *   `version = baseVersion` guard (the builders' guard forms are exactly the
 *   no-op-on-CAS-miss guards this path relies on — a tripped guard inserts 0
 *   rows, leaving no changelog row or bump for a non-applied write);
 * - a UNIQUE violation on sync_changes inside a batch aborts the whole chunk
 *   (implicit transaction), so the group falls back to the serial path: the
 *   racing replay re-checks the dedupe and resolves as idempotent `applied`,
 *   exactly like `commitEntityBatch`'s in-batch replay mapping.
 *
 * Invariants kept from `secure-sync-backend` (Phase 1): every read/write is
 * project-scoped, `project_id` is never updated, infrastructure failures
 * THROW (500 + retryable) — they are never converted into fake conflicts.
 */

export interface BatchedEntry {
  /** Index of the mutation in the original request (outcome alignment). */
  idx: number;
  mutation: SyncMutation;
}

type D1Result = { meta?: { changes?: number }; results?: unknown[] };

/**
 * Max statements per D1 batch call. Real D1 caps the statements per batch;
 * chunking at 80 stays under the ceiling while keeping every mutation's
 * statement block (≤ 4 statements) intact within one chunk.
 */
const MAX_STATEMENTS_PER_BATCH = 80;

/**
 * Apply a group of pairwise-independent non-create mutations, writing each
 * entry's outcome into `outcomes[idx]` and any conflict into `conflicts`.
 * Throws on infrastructure failures (D1 outage, non-replay constraint
 * violations) so the top-level handler answers 500 + retryable.
 */
export async function applyBatchedMutations(
  env: Env,
  actorId: string,
  entries: BatchedEntry[],
  outcomes: (SyncMutationOutcome | undefined)[],
  conflicts: SyncConflict[]
): Promise<void> {
  if (entries.length === 0) return;
  const now = nowIso();

  // ---- Phase R: the group's ENTIRE pre-batch read in shared batch chunks —
  // per mutation: dedupe + existence, plus the current-row read for updates.
  interface Plan {
    entry: BatchedEntry;
    table: TableKey | null;
    replayed: boolean;
    exists: boolean;
    row: unknown;
  }
  const readStmts: D1PreparedStatement[] = [];
  const slots: {
    plan: Plan;
    dedupeAt: number;
    existsAt: number;
    rowAt: number;
  }[] = [];
  for (const entry of entries) {
    const plan: Plan = {
      entry,
      table: tableFor(entry.mutation.entityType),
      replayed: false,
      exists: false,
      row: null,
    };
    const slot = { plan, dedupeAt: -1, existsAt: -1, rowAt: -1 };
    slot.dedupeAt = readStmts.length;
    readStmts.push(prepareMutationDedupeStatement(env, entry.mutation));
    if (plan.table) {
      slot.existsAt = readStmts.length;
      readStmts.push(
        prepareEntityExistsStatement(
          env,
          plan.table,
          entry.mutation.entityId,
          entry.mutation.projectId
        )
      );
      if (entry.mutation.operation === 'update') {
        const rowStmt = prepareReadEntityRow(
          env,
          entry.mutation,
          entry.mutation.projectId
        );
        if (rowStmt) {
          slot.rowAt = readStmts.length;
          readStmts.push(rowStmt);
        }
      }
    }
    slots.push(slot);
  }
  const readResults = await batchInChunks(env, readStmts);
  for (const slot of slots) {
    slot.plan.replayed =
      (readResults[slot.dedupeAt]?.results ?? []).length > 0;
    slot.plan.exists =
      slot.existsAt < 0 ||
      (readResults[slot.existsAt]?.results ?? []).length > 0;
    if (slot.rowAt >= 0) {
      slot.plan.row = (readResults[slot.rowAt]?.results ?? [])[0] ?? null;
    }
  }

  // ---- Per-entry resolution (exact `applyMutation` precedence) + write
  // blocks. Replayed/conflicted/skipped entries never reach the write batch.
  interface Block {
    entry: BatchedEntry;
    /** Position of the block's first statement in the flat write array. */
    start: number;
    length: number;
    /** Guarded (CAS) block vs legacy unguarded delete block. */
    guarded: boolean;
  }
  const writeStmts: D1PreparedStatement[] = [];
  const blocks: Block[] = [];

  for (const slot of slots) {
    const { entry, replayed, exists, row, table } = slot.plan;
    const mutation = entry.mutation;

    // 1) Replayed (project, clientMutationId): idempotent success, nothing
    // written (applyMutation returns {} → outcome applied).
    if (replayed) {
      outcomes[entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      };
      continue;
    }

    // 2) Unsupported type. Unreachable here — `project` mutations never reach
    // batching — but kept so precedence matches applyMutation exactly.
    if (!table) {
      const conflict = {
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        clientMutationId: mutation.clientMutationId,
        message: 'Unsupported entity type',
        currentVersion: 0,
        expectedVersion: mutation.baseVersion,
      };
      conflicts.push(conflict);
      outcomes[entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'conflict',
        message: conflict.message,
      };
      continue;
    }

    // 3) Presence resolved on the live basis BEFORE the version guard: an
    // update/delete targeting a tombstone — or another project's entity — is
    // a clean not-found conflict with zero writes.
    if (!exists) {
      const conflict = entityNotFoundConflict(mutation, 0);
      conflicts.push(conflict);
      outcomes[entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'conflict',
        message: conflict.message,
      };
      continue;
    }

    // 4) Mandatory CAS basis for updates: per-mutation bad-mutation outcome,
    // never applied, never defaulted to 0.
    if (
      mutation.operation === 'update' &&
      mutation.baseVersion === undefined
    ) {
      outcomes[entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'skipped',
        reason: 'missing_base_version',
      };
      continue;
    }

    // 5) Entity statement — the same builders the serial path uses, fed with
    // the pre-read row so the generated SQL is identical.
    let entityStmt: D1PreparedStatement;
    if (mutation.operation === 'delete') {
      entityStmt = prepareSoftDelete(
        env,
        table,
        mutation.entityId,
        mutation.projectId,
        now,
        mutation.entityType,
        mutation.baseVersion
      );
    } else {
      try {
        const built = prepareUpdateFromRow(
          env,
          mutation,
          mutation.projectId,
          now,
          mutation.baseVersion,
          row
        );
        if (!built) {
          // Row vanished between the pre-read and the build (unreachable
          // single-threaded): the serial path answers the same not-found
          // conflict from buildEntityStatement's null result.
          const conflict = entityNotFoundConflict(mutation, 0);
          conflicts.push(conflict);
          outcomes[entry.idx] = {
            clientMutationId: mutation.clientMutationId,
            status: 'conflict',
            message: conflict.message,
          };
          continue;
        }
        entityStmt = built;
      } catch (error) {
        // Only the engine's own invalid-patch signals become conflicts (fixed
        // client-safe message); D1 failures and anything else propagate to
        // the top-level handler (500 + retryable).
        if (!(error instanceof MutationPatchError)) throw error;
        const conflict = invalidPatchConflict(mutation, 0);
        conflicts.push(conflict);
        outcomes[entry.idx] = {
          clientMutationId: mutation.clientMutationId,
          status: 'conflict',
          message: conflict.message,
        };
        continue;
      }
    }

    // 6) Statement block — exactly `commitEntityBatch`'s layout. The guarded
    // changelog INSERT (INSERT ... SELECT ... WHERE version = baseVersion)
    // and the CAS bump are the builders' existing guard forms: on a CAS miss
    // they insert/update 0 rows, so dependents never outlive a failed write.
    // Move fan-out: after the project-scoped existence check the detected
    // project always equals the mutation's own (documented as effectively
    // unreachable), so passing `mutation.projectId` yields the identical
    // (always-null) result without the extra read.
    const fanOut = describeMoveFanOut(
      mutation.entityType,
      mutation.operation,
      mutation.projectId,
      mutation
    );
    const start = writeStmts.length;
    if (mutation.baseVersion !== undefined) {
      const guard = {
        projectId: mutation.projectId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        version: mutation.baseVersion,
      };
      // In-batch read: authoritative currentVersion for a CAS-conflict message.
      writeStmts.push(
        prepareReadEntityVersion(
          env,
          mutation.projectId,
          mutation.entityType,
          mutation.entityId
        )
      );
      writeStmts.push(entityStmt);
      if (fanOut) {
        for (const rowChange of fanOut) {
          writeStmts.push(
            prepareInsertSyncChangeRow(
              env,
              actorId,
              mutation,
              rowChange.projectId,
              rowChange.operation,
              rowChange.patch,
              now,
              guard
            )
          );
        }
      } else {
        writeStmts.push(
          prepareInsertSyncChange(env, actorId, mutation, now, guard)
        );
      }
      writeStmts.push(
        prepareCasIncrementVersion(
          env,
          mutation.projectId,
          mutation.entityType,
          mutation.entityId,
          now,
          mutation.baseVersion
        )
      );
      blocks.push({
        entry,
        start,
        length: writeStmts.length - start,
        guarded: true,
      });
    } else {
      // Legacy unguarded delete (no baseVersion): same shape as
      // commitEntityBatch's legacy path.
      writeStmts.push(entityStmt);
      if (fanOut) {
        for (const rowChange of fanOut) {
          writeStmts.push(
            prepareInsertSyncChangeRow(
              env,
              actorId,
              mutation,
              rowChange.projectId,
              rowChange.operation,
              rowChange.patch,
              now
            )
          );
        }
      } else {
        writeStmts.push(prepareInsertSyncChange(env, actorId, mutation, now));
      }
      writeStmts.push(
        prepareIncrementVersion(
          env,
          mutation.projectId,
          mutation.entityType,
          mutation.entityId,
          now
        )
      );
      blocks.push({
        entry,
        start,
        length: writeStmts.length - start,
        guarded: false,
      });
    }
  }

  if (blocks.length === 0) return;

  // ---- Phase W: the write sequence, chunked on BLOCK boundaries so a
  // mutation's statement block is never split across two batches.
  let results: D1Result[];
  try {
    const chunks: D1PreparedStatement[][] = [];
    let current: D1PreparedStatement[] = [];
    for (const block of blocks) {
      const blockStmts = writeStmts.slice(block.start, block.start + block.length);
      if (current.length > 0 && current.length + blockStmts.length > MAX_STATEMENTS_PER_BATCH) {
        chunks.push(current);
        current = [];
      }
      current.push(...blockStmts);
    }
    if (current.length > 0) chunks.push(current);

    const chunkResults: D1Result[][] = [];
    for (const chunk of chunks) {
      chunkResults.push(
        (await env.D1_DATABASE.batch(chunk)) as D1Result[]
      );
    }
    results = chunkResults.flat();
  } catch (error) {
    // Concurrent replay of a (project_id, client_mutation_id) that raced past
    // the pre-read: D1 rolled the chunk back. Re-apply the group's WRITTEN
    // entries through the serial path — already-committed entries hit the
    // dedupe pre-check and replay as idempotent `applied`, matching
    // commitEntityBatch's mapping. Entries resolved before the write phase
    // (replays, not-found conflicts, skips) are deterministic and keep their
    // already-assigned outcomes, so no conflict is reported twice.
    if (isUniqueMutationIdViolation(error)) {
      return applySerialFallback(
        env,
        actorId,
        blocks.map((block) => block.entry),
        outcomes,
        conflicts
      );
    }
    throw error;
  }

  // ---- Outcome mapping. The CAS bump (LAST statement of a guarded block) is
  // the authoritative conflict signal — the same rule commitEntityBatch uses.
  // The entity write carries the identical guard, so both report 0 together;
  // consulting the bump (instead of the entity statement) mirrors the serial
  // engine exactly, including its outcome in the row-vanished race.
  for (const block of blocks) {
    const mutation = block.entry.mutation;
    if (!block.guarded) {
      // Legacy unguarded delete: no CAS signal to read; applied like
      // commitEntityBatch's legacy path (existence was pre-checked).
      outcomes[block.entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      };
      continue;
    }
    const cas = results[block.start + block.length - 1];
    if ((cas?.meta?.changes ?? 0) === 0) {
      const read = results[block.start] as
        | { results?: { version?: number }[] }
        | undefined;
      const conflict = versionConflict(
        mutation,
        read?.results?.[0]?.version ?? 0
      );
      conflicts.push(conflict);
      outcomes[block.entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'conflict',
        message: conflict.message,
      };
    } else {
      outcomes[block.entry.idx] = {
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      };
    }
  }
}

/**
 * Batch chunks sized on block boundaries (see MAX_STATEMENTS_PER_BATCH).
 * Results are returned in flat statement order — `Block.start` stays valid.
 */
async function batchInChunks(
  env: Env,
  stmts: D1PreparedStatement[]
): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += MAX_STATEMENTS_PER_BATCH) {
    const chunk = stmts.slice(i, i + MAX_STATEMENTS_PER_BATCH);
    const results = (await env.D1_DATABASE.batch(chunk)) as D1Result[];
    out.push(...results);
  }
  return out;
}

/**
 * Replay-race fallback: re-run the whole group serially. Committed entries are
 * dedupe hits (idempotent applied); the racing entry either replays or applies
 * fresh — the end state equals serial application.
 */
async function applySerialFallback(
  env: Env,
  actorId: string,
  entries: BatchedEntry[],
  outcomes: (SyncMutationOutcome | undefined)[],
  conflicts: SyncConflict[]
): Promise<void> {
  for (const { idx, mutation } of entries) {
    const result = await applyMutation(env, actorId, mutation);
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
}
