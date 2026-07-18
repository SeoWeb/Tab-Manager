import { describe, it, expect, beforeEach } from 'vitest';
import { applyMutation } from '../../sync';
import type { DB, Env } from './harness';
import { makeEnv, baseDb, versionOf, mutation } from './harness';

describe('applyMutation soft-delete basis: conflicts on tombstones', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = baseDb();
    env = makeEnv(db);
  });

  it('update on a soft-deleted entity returns a not-found conflict, no version bump, no change row', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-dead',
        operation: 'update',
        patch: { title: 'new title' },
      })
    );

    expect(result.conflict).toBeDefined();
    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(versionOf(db, 't-dead')).toBe(7); // unchanged
    expect(db.sync_changes).toHaveLength(0);
  });

  it('delete on a soft-deleted entity returns a not-found conflict, no version bump, no change row', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'collection',
        entityId: 'c-dead',
        operation: 'delete',
      })
    );

    expect(result.conflict).toBeDefined();
    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(versionOf(db, 'c-dead')).toBe(5); // unchanged
    expect(db.sync_changes).toHaveLength(0);
  });

  it('update with a MATCHING baseVersion on a tombstone yields not-found, never a version conflict', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-dead',
        operation: 'update',
        baseVersion: 7, // matches the tombstone's real version
        patch: { title: 'x' },
      })
    );

    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(result.conflict?.message).not.toBe('Entity version conflict');
    expect(db.sync_changes).toHaveLength(0);
  });

  it('delete on an already-deleted project returns a conflict, no version bump, no change row', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p-dead',
        projectId: 'p-dead',
        operation: 'delete',
      })
    );

    expect(result.conflict).toBeDefined();
    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(versionOf(db, 'p-dead')).toBe(3); // no phantom bump
    expect(db.sync_changes).toHaveLength(0); // no spurious delete change
  });
});
