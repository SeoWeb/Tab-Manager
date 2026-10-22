import { describe, it, expect } from 'vitest';
import { applyMutation } from '../sync';
import { isUniqueMutationIdViolation } from '../sync/statements/changelog';
import type { DB, Env } from './cases/harness';
import { makeEnv, baseDb, versionOf, mutation } from './cases/harness';

/**
 * Idempotency tests (change `secure-sync-backend` §3.3):
 *
 * Migration 0004 added UNIQUE(project_id, client_mutation_id) on sync_changes.
 * The engine must treat that violation as "already applied": a replay that
 * raced past the pre-check maps to an idempotent SUCCESS (batch rolled back by
 * D1, second request answered `applied`), never an error and never a duplicate
 * changelog row.
 *
 * The harness mock models the unique constraint (throwing on a duplicate
 * (project_id, client_mutation_id) insert) and D1 batch atomicity (rollback on
 * a throwing statement), so the mapping is exercised end-to-end at the engine
 * level. A later batch adds a miniflare harness for the HTTP surface.
 */

describe('isUniqueMutationIdViolation (the migration-0004 mapping)', () => {
  it('recognizes the sync_changes unique violation', () => {
    expect(
      isUniqueMutationIdViolation(
        new Error(
          'UNIQUE constraint failed: sync_changes.project_id, sync_changes.client_mutation_id'
        )
      )
    ).toBe(true);
    // Pre-0004 index shape also names the table:
    expect(
      isUniqueMutationIdViolation(
        new Error('UNIQUE constraint failed: sync_changes.client_mutation_id')
      )
    ).toBe(true);
  });

  it('rejects other constraints and non-errors', () => {
    expect(isUniqueMutationIdViolation(new Error('UNIQUE constraint failed: tasks.id'))).toBe(false);
    expect(
      isUniqueMutationIdViolation(new Error('D1_ERROR: disk I/O error'))
    ).toBe(false);
    expect(isUniqueMutationIdViolation('UNIQUE constraint failed')).toBe(false);
    expect(isUniqueMutationIdViolation(null)).toBe(false);
  });
});

describe('replays of the same clientMutationId apply exactly once', () => {
  it('two identical create submissions: entity created once, ONE changelog row, second answered applied', async () => {
    const db = baseDb();
    const env = makeEnv(db);
    const create = () =>
      mutation({
        clientMutationId: 'cm-dup',
        entityType: 'task',
        entityId: 't-new',
        operation: 'create',
        patch: { title: 'once' },
      });

    const first = await applyMutation(env, 'u1', create());
    expect(first.conflict).toBeUndefined();
    expect(first.skipped).toBeUndefined();

    const second = await applyMutation(env, 'u1', create());
    // The replay pre-check answers an idempotent success.
    expect(second.conflict).toBeUndefined();
    expect(second.skipped).toBeUndefined();

    // Created exactly once: one version row at 1, one changelog row.
    expect(versionOf(db, 't-new')).toBe(1);
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.client_mutation_id).toBe('cm-dup');
    expect(db.sync_changes[0]?.project_id).toBe('p1');
  });

  it('a replay that races past the pre-check hits the UNIQUE index and maps to applied, writing nothing', async () => {
    const db = baseDb();
    const env = envHidingReplayPrecheck(makeEnv(db));

    // First submission applies normally: update t-live 2 → 3.
    const first = await applyMutation(
      env,
      'u1',
      mutation({
        clientMutationId: 'cm-race',
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'first' },
      })
    );
    expect(first.conflict).toBeUndefined();
    expect(versionOf(db, 't-live')).toBe(3);

    // Second submission carries a DIFFERENT payload but reuses the mutation id
    // (client bug / retried send). Its pre-check is hidden to simulate the
    // race window; the changelog UNIQUE index rejects it inside the batch, D1
    // rolls the batch back, and the engine maps the violation to success.
    const second = await applyMutation(
      env,
      'u1',
      mutation({
        clientMutationId: 'cm-race',
        entityType: 'collection',
        entityId: 'c-live',
        operation: 'delete', // legacy path (no baseVersion) reaches the insert
      })
    );

    expect(second.conflict).toBeUndefined();
    expect(second.skipped).toBeUndefined();
    // Rolled back: the collection was NOT deleted, no duplicate changelog row.
    expect(db.collections.find((c) => c.id === 'c-live')?.deleted_at).toBeNull();
    expect(versionOf(db, 'c-live')).toBeUndefined();
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.client_mutation_id).toBe('cm-race');
  });
});

/**
 * Wrap a harness env so the replay pre-check always misses — simulating two
 * concurrent submissions that both pass the pre-check before either commits.
 */
function envHidingReplayPrecheck(base: Env): Env {
  const d1 = base.D1_DATABASE;
  return {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => {
        if (
          /SELECT id FROM sync_changes WHERE project_id = \? AND client_mutation_id = \?/.test(
            sql
          )
        ) {
          return {
            bind: () => ({
              first: async () => null,
              all: async () => ({ results: [] }),
              run: async () => ({ meta: { changes: 0 } }),
              __exec: () => ({ meta: { changes: 0 } }),
            }),
          };
        }
        return d1.prepare(sql);
      },
      batch: (stmts: Parameters<typeof d1.batch>[0]) => d1.batch(stmts),
    },
  } as unknown as Env;
}
