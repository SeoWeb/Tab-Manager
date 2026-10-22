import { describe, it, expect, beforeEach } from 'vitest';
import { applyMutation } from '../sync';
import type { DB, Env } from './cases/harness';
import { makeEnv, baseDb, versionOf, mutation, NOW } from './cases/harness';

/**
 * CAS + mandatory-baseVersion tests (change `secure-sync-backend` §2.2, §3.1,
 * §3.4):
 *
 * - an UPDATE without `baseVersion` is a per-mutation `skipped` outcome
 *   (reason `missing_base_version`) — never applied, never defaulted to 0;
 * - the version read runs INSIDE the apply batch and the entity write, the
 *   change-log row and the version bump all carry the same
 *   `version = baseVersion` guard, so a lost race writes NOTHING;
 * - two updates with the same baseVersion: exactly one applies.
 */

describe('mandatory baseVersion for updates (§2.2)', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = baseDb();
    env = makeEnv(db);
  });

  it('update without baseVersion → skipped missing_base_version, nothing written', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        // no baseVersion
        patch: { title: 'should not land' },
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(result.skipped).toEqual({ reason: 'missing_base_version' });
    expect(versionOf(db, 't-live')).toBe(2); // unchanged
    expect(db.tasks.find((t) => t.id === 't-live')?.title).toBe('Task');
    expect(db.sync_changes).toHaveLength(0);
  });

  it('project update without baseVersion → skipped missing_base_version', async () => {
    db.entity_versions.push({
      project_id: 'p1',
      entity_type: 'project',
      entity_id: 'p1',
      version: 4,
      updated_at: NOW,
    });

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'update',
        // no baseVersion
        patch: { name: 'Renamed' },
      })
    );

    expect(result.skipped).toEqual({ reason: 'missing_base_version' });
    expect(db.projects.find((p) => p.id === 'p1')?.name).toBe('Project');
    expect(versionOf(db, 'p1')).toBe(4); // unchanged
    expect(db.sync_changes).toHaveLength(0);
  });

  it('deletes remain applyable without baseVersion (legacy path)', async () => {
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
    expect(result.skipped).toBeUndefined();
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.sync_changes).toHaveLength(1);
  });
});

describe('compare-and-swap apply batch (§3.1)', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = baseDb();
    env = makeEnv(db);
  });

  it('stale baseVersion → conflict with the authoritative in-batch version, NOTHING written', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 1, // actual is 2
        patch: { title: 'raced' },
      })
    );

    expect(result.conflict?.message).toBe('Entity version conflict');
    // The conflict's currentVersion comes from the in-batch version read.
    expect(result.conflict?.currentVersion).toBe(2);
    expect(result.conflict?.expectedVersion).toBe(1);
    // Entity unchanged, no version bump, no change-log row: the guarded
    // changelog insert no-ops together with the CAS write.
    expect(db.tasks.find((t) => t.id === 't-live')?.title).toBe('Task');
    expect(versionOf(db, 't-live')).toBe(2);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('matching baseVersion applies: entity written, version bumped, change logged', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'updated' },
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(db.tasks.find((t) => t.id === 't-live')?.title).toBe('updated');
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.operation).toBe('update');
  });

  it('a CAS delete with a matching baseVersion applies and is logged', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'delete',
        baseVersion: 2,
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(db.tasks.find((t) => t.id === 't-live')?.deleted_at).not.toBeNull();
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.sync_changes).toHaveLength(1);
  });

  it('an entity without a version row can never be updated through the CAS path', async () => {
    db.tasks.push({
      id: 't-noversion',
      project_id: 'p1',
      collection_id: null,
      title: 'No version',
      payload_json: '{}',
      order_index: null,
      deleted_at: null,
    });

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-noversion',
        operation: 'update',
        baseVersion: 0, // "default to 0" must not help: the row is missing
        patch: { title: 'x' },
      })
    );

    expect(result.conflict?.message).toBe('Entity version conflict');
    expect(db.tasks.find((t) => t.id === 't-noversion')?.title).toBe(
      'No version'
    );
    expect(db.sync_changes).toHaveLength(0);
  });
});

describe('two updates with the same baseVersion → exactly one applies (§3.4)', () => {
  it('the second submission loses the CAS and gets a conflict, not a write', async () => {
    const db = baseDb();
    const env = makeEnv(db);

    const first = await applyMutation(
      env,
      'u1',
      mutation({
        clientMutationId: 'cm-first',
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'winner' },
      })
    );
    expect(first.conflict).toBeUndefined();

    const second = await applyMutation(
      env,
      'u1',
      mutation({
        clientMutationId: 'cm-second',
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2, // same basis — already consumed by the winner
        patch: { title: 'loser' },
      })
    );

    expect(second.conflict?.message).toBe('Entity version conflict');
    expect(second.conflict?.currentVersion).toBe(3);
    expect(second.conflict?.expectedVersion).toBe(2);
    expect(db.tasks.find((t) => t.id === 't-live')?.title).toBe('winner');
    expect(versionOf(db, 't-live')).toBe(3); // bumped exactly once
    expect(db.sync_changes).toHaveLength(1);
  });
});

describe('project updates and deletes run through the same CAS', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = baseDb();
    db.entity_versions.push({
      project_id: 'p1',
      entity_type: 'project',
      entity_id: 'p1',
      version: 4,
      updated_at: NOW,
    });
    db.project_members = [
      { project_id: 'p1', user_id: 'u1', role: 'owner' },
    ];
    env = makeEnv(db);
  });

  it('matching baseVersion: project renamed, version bumped, change logged', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'update',
        baseVersion: 4,
        patch: { name: 'Renamed' },
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(db.projects.find((p) => p.id === 'p1')?.name).toBe('Renamed');
    expect(versionOf(db, 'p1')).toBe(5);
    expect(db.sync_changes).toHaveLength(1);
  });

  it('stale baseVersion: conflict, nothing written', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'update',
        baseVersion: 3,
        patch: { name: 'Renamed' },
      })
    );

    expect(result.conflict?.message).toBe('Entity version conflict');
    expect(result.conflict?.currentVersion).toBe(4);
    expect(db.projects.find((p) => p.id === 'p1')?.name).toBe('Project');
    expect(versionOf(db, 'p1')).toBe(4);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('project delete with a stale baseVersion: conflict, project survives', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'delete',
        baseVersion: 2,
      })
    );

    expect(result.conflict?.message).toBe('Entity version conflict');
    expect(db.projects.find((p) => p.id === 'p1')?.deleted_at).toBeNull();
    expect(versionOf(db, 'p1')).toBe(4);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('project delete with a matching baseVersion: owner succeeds', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'delete',
        baseVersion: 4,
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(db.projects.find((p) => p.id === 'p1')?.deleted_at).not.toBeNull();
    expect(versionOf(db, 'p1')).toBe(5);
    expect(db.sync_changes).toHaveLength(1);
  });
});
