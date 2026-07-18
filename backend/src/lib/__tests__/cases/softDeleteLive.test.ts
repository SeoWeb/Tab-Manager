import { describe, it, expect, beforeEach } from 'vitest';
import { applyMutation } from '../../sync';
import type { DB, Env } from './harness';
import { makeEnv, baseDb, versionOf, mutation } from './harness';

describe('applyMutation soft-delete basis: live-entity mutations succeed', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = baseDb();
    env = makeEnv(db);
  });

  it('regression: update on a LIVE entity succeeds, bumps version, writes a change row', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        patch: { title: 'updated' },
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(versionOf(db, 't-live')).toBe(3); // 2 -> 3
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.operation).toBe('update');
  });

  it('regression: delete on a LIVE entity succeeds, bumps version, writes a change row', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'delete',
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.tasks.find((t) => t.id === 't-live')?.deleted_at).not.toBeNull();
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.operation).toBe('delete');
  });
});
