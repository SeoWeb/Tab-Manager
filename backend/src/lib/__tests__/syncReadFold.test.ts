import { describe, it, expect } from 'vitest';
import { applyMutation } from '../sync/applyMutation';
import type { ApplyMutationResult } from '../sync/shared';
import type { Env } from '../../types';
import type { DB } from './cases/harness';
import { makeEnv, baseDb, versionOf, mutation } from './cases/harness';

/**
 * applyMutation folds its two independent pre-write reads — the idempotency
 * dedupe (sync_changes by project + clientMutationId) and the project-scoped
 * existence check — into ONE D1 batch round-trip (per-statement results arrive
 * in order). The move-detection read stays separate (it depends on presence
 * passing).
 *
 * These tests pin outcome EQUIVALENCE of the folded path for the three
 * canonical cases — replayed mutation, nonexistent entity, normal update — and
 * assert the round-trip count actually dropped (the reads ride a single batch).
 */

function dbWithEditor(): DB {
  const db = baseDb();
  db.project_members = [
    { project_id: 'p1', user_id: 'u1', role: 'editor' },
  ];
  return db;
}

/** Wrap a harness env, counting D1 batch round-trips. */
function envCountingBatches(base: Env): {
  env: Env;
  counts: { batches: number };
} {
  const d1 = base.D1_DATABASE;
  const counts = { batches: 0 };
  const env = {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => d1.prepare(sql),
      batch: (stmts: Parameters<typeof d1.batch>[0]) => {
        counts.batches++;
        return d1.batch(stmts);
      },
    },
  } as unknown as Env;
  return { env, counts };
}

function outcomeOf(result: ApplyMutationResult): string {
  if (result.conflict) return 'conflict';
  if (result.skipped) return 'skipped';
  return 'applied';
}

describe('applyMutation folded read batch (dedupe + existence in one round-trip)', () => {
  it('a replayed mutation is idempotent success via a single read batch', async () => {
    const db = dbWithEditor();
    db.sync_changes.push({
      id: 1,
      project_id: 'p1',
      entity_id: 't-live',
      operation: 'update',
      client_mutation_id: 'cm-dup',
    });
    const { env, counts } = envCountingBatches(makeEnv(db));

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        clientMutationId: 'cm-dup',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'replay' },
      })
    );

    // Dedupe hit ⇒ applied with nothing further read or written.
    expect(result).toEqual({});
    expect(outcomeOf(result)).toBe('applied');
    // ONE batch round-trip: dedupe + existence folded together.
    expect(counts.batches).toBe(1);
    // No writes: version unchanged, no second changelog row.
    expect(versionOf(db, 't-live')).toBe(2);
    expect(db.sync_changes).toHaveLength(1);
  });

  it('a nonexistent entity yields the not-found conflict via a single read batch', async () => {
    const db = dbWithEditor();
    const { env, counts } = envCountingBatches(makeEnv(db));

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityId: 'missing-task',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'ghost' },
      })
    );

    // Existence miss ⇒ the clean not-found conflict, zero writes.
    expect(result.conflict?.message).toBe(
      'Entity not found or already deleted'
    );
    expect(result.conflict?.entityId).toBe('missing-task');
    expect(outcomeOf(result)).toBe('conflict');
    expect(counts.batches).toBe(1);
    expect(versionOf(db, 'missing-task')).toBeUndefined();
    expect(db.sync_changes).toHaveLength(0);
  });

  it('a normal update applies through the folded reads (read batch + commit batch)', async () => {
    const db = dbWithEditor();
    const { env, counts } = envCountingBatches(makeEnv(db));

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'next' },
      })
    );

    expect(result).toEqual({});
    expect(outcomeOf(result)).toBe('applied');
    // TWO batch round-trips: the folded read batch + the CAS commit batch
    // (down from three sequential reads + commit before the fold).
    expect(counts.batches).toBe(2);
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.tasks.find((t) => t.id === 't-live')?.title).toBe('next');
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.operation).toBe('update');
  });
});
