import { describe, it, expect, beforeEach } from 'vitest';
import { applyMutation } from '../sync';
import { entityExists, getEntityVersion } from '../sync/queries';
import type { DB, Env } from './cases/harness';
import {
  makeEnv,
  baseDb,
  versionOf,
  mutation,
  NOW,
} from './cases/harness';

/**
 * IDOR regression matrix (change `secure-sync-backend` §2.1/§2.6):
 *
 * An editor of project A (route project `p1`) must be unable to update,
 * delete, or move an entity of project B (`p2`) — even when submitting the
 * entity's true `baseVersion`. Every read and write in the engine is scoped by
 * `project_id`, so a foreign id is indistinguishable from a nonexistent one:
 * each attempt yields a conflict/skipped outcome, zero writes to B, and zero
 * change-log rows anywhere.
 */

const FOREIGN_VERSION = 9;

function twoProjectDb(): DB {
  const db = baseDb();
  db.projects.push({
    id: 'p2',
    project_id: 'p2',
    name: 'Other project',
    deleted_at: null,
  });
  db.tasks.push({
    id: 't-foreign',
    project_id: 'p2',
    collection_id: null,
    title: 'Foreign task',
    payload_json: '{}',
    order_index: 0,
    deleted_at: null,
  });
  db.collections.push({
    id: 'c-foreign',
    project_id: 'p2',
    name: 'Foreign collection',
    deleted_at: null,
  });
  db.entity_versions.push(
    {
      project_id: 'p2',
      entity_type: 'task',
      entity_id: 't-foreign',
      version: FOREIGN_VERSION,
      updated_at: NOW,
    },
    {
      project_id: 'p2',
      entity_type: 'collection',
      entity_id: 'c-foreign',
      version: 4,
      updated_at: NOW,
    }
  );
  return db;
}

describe('an editor of project A cannot mutate project B entities', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = twoProjectDb();
    env = makeEnv(db);
  });

  it('UPDATE of a foreign task → not-found conflict, zero writes anywhere', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1', // the route's project — the only one the caller can name
        entityType: 'task',
        entityId: 't-foreign', // lives in p2
        operation: 'update',
        baseVersion: FOREIGN_VERSION, // even with the TRUE version: no usable basis
        patch: { title: 'hijacked' },
      })
    );

    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(result.skipped).toBeUndefined();
    // Zero writes to B…
    expect(db.tasks.find((t) => t.id === 't-foreign')?.title).toBe(
      'Foreign task'
    );
    expect(versionOf(db, 't-foreign')).toBe(FOREIGN_VERSION);
    // …and A's project state is untouched: no version bump, no change log.
    expect(versionOf(db, 't-live')).toBe(2);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('DELETE of a foreign task → not-found conflict, zero writes anywhere', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-foreign',
        operation: 'delete',
        baseVersion: FOREIGN_VERSION,
      })
    );

    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(db.tasks.find((t) => t.id === 't-foreign')?.deleted_at).toBeNull();
    expect(versionOf(db, 't-foreign')).toBe(FOREIGN_VERSION);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('DELETE of a foreign collection → not-found conflict, zero writes anywhere', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1',
        entityType: 'collection',
        entityId: 'c-foreign',
        operation: 'delete',
        baseVersion: 4,
      })
    );

    expect(result.conflict?.message).toBe('Entity not found or already deleted');
    expect(
      db.collections.find((c) => c.id === 'c-foreign')?.deleted_at
    ).toBeNull();
    expect(versionOf(db, 'c-foreign')).toBe(4);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('MOVE of a foreign task (update against another project) is unreachable', async () => {
    // The legacy move scenario submitted a mutation whose projectId differed
    // from the entity's project. Project-scoped reads make the entity
    // invisible, so the move never starts — no fan-out rows anywhere.
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-foreign',
        operation: 'update',
        baseVersion: FOREIGN_VERSION,
        patch: { title: 'smuggled', payload: { moved: true } },
      })
    );

    expect(result.conflict).toBeDefined();
    expect(db.tasks.find((t) => t.id === 't-foreign')?.project_id).toBe('p2');
    expect(versionOf(db, 't-foreign')).toBe(FOREIGN_VERSION);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('project-scoped reads of a foreign entity yield nothing usable', async () => {
    await expect(
      entityExists(env, 'tasks', 't-foreign', 'p1')
    ).resolves.toBe(false);
    await expect(
      entityExists(env, 'tasks', 't-foreign', 'p2')
    ).resolves.toBe(true);
    // The version read scoped to A returns no usable version (0 ≠ 9).
    await expect(
      getEntityVersion(env, 'p1', 'task', 't-foreign')
    ).resolves.toBe(0);
    await expect(
      getEntityVersion(env, 'p2', 'task', 't-foreign')
    ).resolves.toBe(FOREIGN_VERSION);
  });

  it('updating an OWN entity never changes its project_id', async () => {
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        // A hostile client tries to smuggle a cross-project move via the patch.
        patch: { title: 'ok', projectId: 'p2', project_id: 'p2' },
      })
    );

    expect(result.conflict).toBeUndefined();
    const row = db.tasks.find((t) => t.id === 't-live');
    expect(row?.title).toBe('ok');
    expect(row?.project_id).toBe('p1'); // unchanged
    expect(versionOf(db, 't-live')).toBe(3);
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.project_id).toBe('p1');
  });

  it('updating a foreign project entity → Project not found, zero writes', async () => {
    db.entity_versions.push({
      project_id: 'p2',
      entity_type: 'project',
      entity_id: 'p2',
      version: 1,
      updated_at: NOW,
    });

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        projectId: 'p1',
        entityType: 'project',
        entityId: 'p2', // foreign project id named as the entity
        operation: 'update',
        baseVersion: 1,
        patch: { name: 'hijacked' },
      })
    );

    expect(result.conflict?.message).toBe('Project not found');
    expect(db.projects.find((p) => p.id === 'p2')?.name).toBe('Other project');
    expect(versionOf(db, 'p2')).toBe(1);
    expect(db.sync_changes).toHaveLength(0);
  });
});

describe('generated SQL is project-scoped by construction', () => {
  it('every UPDATE/DELETE carries AND project_id = ? and no SET touches project_id', async () => {
    const db = twoProjectDb();
    const { env, sqls } = recordingEnv(makeEnv(db));

    await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'x' },
      })
    );
    await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'delete',
      })
    );

    const writes = sqls.filter((s) => /^\s*UPDATE (tasks|collections|links|notes|todos|projects)\b/.test(s));
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const sql of writes) {
      // Scoped: never by id alone.
      expect(sql).toMatch(/AND project_id = \?/);
      // Never moves an entity across projects: the SET clause (between SET and
      // WHERE) must not touch project_id. The version-guard subquery in the
      // WHERE clause legitimately references project_id, so scope the check.
      const setClause = sql.slice(
        sql.indexOf(' SET ') + ' SET '.length,
        sql.indexOf(' WHERE ')
      );
      expect(setClause).not.toMatch(/\bproject_id\b\s*=/);
    }
  });

  it('row reads used for patch building are project-scoped', async () => {
    const db = twoProjectDb();
    const { env, sqls } = recordingEnv(makeEnv(db));

    await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'task',
        entityId: 't-live',
        operation: 'update',
        baseVersion: 2,
        patch: { title: 'x' },
      })
    );

    // The merge read (SELECT ... FROM tasks WHERE id = ? ...) is scoped.
    const reads = sqls.filter((s) => /SELECT .* FROM tasks WHERE/.test(s));
    expect(reads.length).toBeGreaterThanOrEqual(1);
    for (const sql of reads) {
      expect(sql).toMatch(/AND project_id = \?/);
    }
  });
});

/** Wrap a harness env so every prepared SQL string is recorded. */
function recordingEnv(base: Env): { env: Env; sqls: string[] } {
  const sqls: string[] = [];
  const d1 = base.D1_DATABASE;
  const env = {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => {
        sqls.push(sql);
        return d1.prepare(sql);
      },
      batch: (stmts: Parameters<typeof d1.batch>[0]) => d1.batch(stmts),
    },
  } as unknown as Env;
  return { env, sqls };
}
