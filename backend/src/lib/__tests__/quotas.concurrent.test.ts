import { describe, it, expect } from 'vitest';
import { createProject } from '../crud';
import { acceptInvitation } from '../invitations';
import { syncProject } from '../sync';
import type { Env, SyncMutationOutcome } from '../../types';
import { makeEnv, baseDb, versionOf, NOW, type DB } from './cases/harness';

/**
 * Quota enforcement at the PUBLIC entry points (createProject, acceptInvitation,
 * syncProject), running on the shared in-repo D1 mock (`cases/harness.ts`).
 *
 * The mock models what the old naive per-function mock ignored — and what real
 * D1 does: batched statements execute sequentially and unconditionally (a
 * statement inserting 0 rows does NOT abort the batch), statements report
 * `meta.changes`, FK constraints throw, and UNIQUE indexes are enforced. That
 * makes the "dependent writes committed anyway" bug observable: under a single
 * guard batch, a tripped quota guard would still commit the dependents
 * (orphaned memberships → FK fallout → 500s, invitations marked accepted
 * without a membership, phantom changelog rows / version bumps for blocked
 * creates). These tests pin the two-phase behavior: guard first, check
 * `meta.changes`, dependents only on success.
 */

/** A user + env with a tight project cap. */
function ownerDb(cap: number, owned = 0): { db: DB; env: Env } {
  const db = baseDb();
  db.users.push({ id: 'owner-1', email: 'owner-1@example.com' });
  for (let i = 0; i < owned; i++) {
    db.projects.push({
      id: `p-owned-${i}`,
      project_id: `p-owned-${i}`,
      name: `Owned ${i}`,
      owner_id: 'owner-1',
      deleted_at: null,
    });
  }
  return {
    db,
    env: makeEnv(db, { QUOTA_MAX_PROJECTS_PER_USER: String(cap) }),
  };
}

/** A project (`p-inv`) with `memberCount` members and two pending invitations. */
function inviteDb(memberCount: number, cap: number): { db: DB; env: Env } {
  const db = baseDb();
  db.users.push(
    { id: 'owner-1', email: 'owner-1@example.com' },
    { id: 'u9', email: 'u9@example.com' },
    { id: 'u10', email: 'u10@example.com' }
  );
  db.projects.push({
    id: 'p-inv',
    project_id: 'p-inv',
    name: 'Invite project',
    owner_id: 'owner-1',
    deleted_at: null,
  });
  db.project_members = [
    { project_id: 'p-inv', user_id: 'owner-1', role: 'owner' },
  ];
  for (let i = 0; i < memberCount - 1; i++) {
    db.project_members.push({
      project_id: 'p-inv',
      user_id: `member-${i}`,
      role: 'editor',
    });
  }
  const base = {
    project_id: 'p-inv',
    email: null,
    role: 'viewer',
    created_by: 'owner-1',
    expires_at: '2030-01-01T00:00:00.000Z',
    accepted_at: null,
    created_at: NOW,
  };
  db.invitations.push(
    { ...base, id: 'inv-1', code: 'code-1' },
    { ...base, id: 'inv-2', code: 'code-2' }
  );
  return {
    db,
    env: makeEnv(db, { QUOTA_MAX_MEMBERS_PER_PROJECT: String(cap) }),
  };
}

/** p1 with u1 as editor; p1 already holds 2 live entities (c-live, t-live). */
function editorDb(cap: number): { db: DB; env: Env } {
  const db = baseDb();
  db.project_members = [{ project_id: 'p1', user_id: 'u1', role: 'editor' }];
  return {
    db,
    env: makeEnv(db, { QUOTA_MAX_ENTITIES_PER_PROJECT: String(cap) }),
  };
}

function createMutation(entityId: string, clientMutationId: string) {
  return {
    clientMutationId,
    projectId: 'p1',
    clientId: 'client-1',
    createdAt: NOW,
    entityType: 'task',
    entityId,
    operation: 'create',
    patch: { title: `Task ${entityId}` },
  };
}

interface QuotaErrorBody {
  error: { message: string };
}

describe('createProject: two-phase quota commit', () => {
  it('commits project + owner membership + changelog within the cap', async () => {
    const { db, env } = ownerDb(2);
    const res = await createProject(env, { id: 'owner-1' }, { name: 'First' });

    expect(res.status).toBe(201);
    const project = (await res.json()) as { id: string; name: string };
    expect(project.name).toBe('First');
    expect(
      db.projects.some((p) => p.id === project.id && p.owner_id === 'owner-1')
    ).toBe(true);
    expect(
      db.project_members.some(
        (m) =>
          m.project_id === project.id &&
          m.user_id === 'owner-1' &&
          m.role === 'owner'
      )
    ).toBe(true);
    expect(
      db.entity_versions.some(
        (v) =>
          v.project_id === project.id &&
          v.entity_id === project.id &&
          v.version === 1
      )
    ).toBe(true);
    expect(
      db.sync_changes.some(
        (c) =>
          c.project_id === project.id &&
          c.entity_id === project.id &&
          c.operation === 'create'
      )
    ).toBe(true);
  });

  it('returns a structured 403 at the cap and executes NO dependents', async () => {
    const { db, env } = ownerDb(2, 2);
    const res = await createProject(env, { id: 'owner-1' }, { name: 'Third' });

    // 403 — not the 500 the old single-batch code produced when the orphaned
    // membership insert tripped the project_members FK constraint.
    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 2 projects');

    // Nothing leaked: no project, no membership, no version seed, no changelog.
    expect(
      db.projects.filter((p) => p.owner_id === 'owner-1' && p.deleted_at === null)
    ).toHaveLength(2);
    expect(db.project_members).toHaveLength(1); // only the baseDb p-dead seed
    expect(db.entity_versions).toHaveLength(4); // unchanged
    expect(db.sync_changes).toHaveLength(0);
  });

  it('lets at most one concurrent create win the final slot', async () => {
    const { db, env } = ownerDb(2, 1);

    const results = await Promise.all([
      createProject(env, { id: 'owner-1' }, { name: 'Second A' }),
      createProject(env, { id: 'owner-1' }, { name: 'Second B' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(
      db.projects.filter(
        (p) => p.owner_id === 'owner-1' && p.deleted_at === null
      )
    ).toHaveLength(2);
  });
});

describe('acceptInvitation: two-phase quota commit', () => {
  it('creates the membership and marks the invitation accepted within the cap', async () => {
    const { db, env } = inviteDb(2, 3);
    const res = await acceptInvitation(
      env,
      { id: 'u9', email: 'u9@example.com' },
      'code-1'
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project_id: string;
      role: string;
      accepted: boolean;
    };
    expect(body).toMatchObject({
      project_id: 'p-inv',
      role: 'viewer',
      accepted: true,
    });
    expect(
      db.project_members.some(
        (m) => m.project_id === 'p-inv' && m.user_id === 'u9'
      )
    ).toBe(true);
    expect(
      db.invitations.find((i) => i.id === 'inv-1')?.accepted_at
    ).not.toBeNull();
  });

  it('403s at the member cap and leaves the invitation unaccepted (retryable)', async () => {
    const { db, env } = inviteDb(2, 2);
    const res = await acceptInvitation(
      env,
      { id: 'u9', email: 'u9@example.com' },
      'code-1'
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 2 members');

    // The invitation row is UNCHANGED — still retryable once capacity frees up.
    expect(db.invitations.find((i) => i.id === 'inv-1')?.accepted_at).toBeNull();
    expect(db.project_members.filter((m) => m.project_id === 'p-inv')).toHaveLength(2);
  });

  it('lets at most one concurrent accept win the final slot', async () => {
    const { db, env } = inviteDb(2, 3);

    const results = await Promise.all([
      acceptInvitation(env, { id: 'u9', email: 'u9@example.com' }, 'code-1'),
      acceptInvitation(env, { id: 'u10', email: 'u10@example.com' }, 'code-2'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(db.project_members.filter((m) => m.project_id === 'p-inv')).toHaveLength(3);
    const accepted = db.invitations.filter((i) => i.accepted_at !== null);
    expect(accepted).toHaveLength(1);
  });
});

describe('sync entity creates: two-phase quota commit', () => {
  it('403s at the entity cap with no changelog rows or version bumps', async () => {
    const { db, env } = editorDb(2); // already at cap: c-live + t-live
    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [createMutation('t-new', 'cm-1')],
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 2 entities');

    expect(db.tasks.some((t) => t.id === 't-new')).toBe(false);
    expect(db.sync_changes).toHaveLength(0);
    expect(versionOf(db, 't-new')).toBeUndefined();
  });

  it('commits within-capacity creates durably and blocks only the overflow', async () => {
    const { db, env } = editorDb(3); // one slot left
    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        createMutation('t-a', 'cm-1'),
        createMutation('t-b', 'cm-2'),
      ],
    });

    // The overflow (t-b) is refused with the structured 403...
    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 3 entities');

    // ...while the within-capacity create is durably committed, changelog included.
    expect(db.tasks.some((t) => t.id === 't-a')).toBe(true);
    expect(
      db.sync_changes.some(
        (c) => c.entity_id === 't-a' && c.operation === 'create'
      )
    ).toBe(true);
    expect(versionOf(db, 't-a')).toBe(1);

    // The blocked create left no trace at all.
    expect(db.tasks.some((t) => t.id === 't-b')).toBe(false);
    expect(db.sync_changes.some((c) => c.entity_id === 't-b')).toBe(false);
    expect(versionOf(db, 't-b')).toBeUndefined();
  });

  it('applies all creates with applied outcomes when capacity suffices', async () => {
    const { db, env } = editorDb(4);
    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        createMutation('t-a', 'cm-1'),
        createMutation('t-b', 'cm-2'),
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcomes: SyncMutationOutcome[] };
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied', 'applied']);
    expect(db.tasks.some((t) => t.id === 't-a')).toBe(true);
    expect(db.tasks.some((t) => t.id === 't-b')).toBe(true);
    expect(db.sync_changes.filter((c) => c.operation === 'create')).toHaveLength(2);
    expect(versionOf(db, 't-a')).toBe(1);
    expect(versionOf(db, 't-b')).toBe(1);
  });

  it('a quota breach aborts the request before non-create mutations run', async () => {
    const { db, env } = editorDb(2); // at cap
    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        createMutation('t-new', 'cm-1'),
        {
          clientMutationId: 'cm-2',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 't-live',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'Changed' },
        },
      ],
    });

    expect(res.status).toBe(403);
    // The update was never attempted.
    const liveTask = db.tasks.find((t) => t.id === 't-live');
    expect(liveTask?.title).toBe('Task');
    expect(versionOf(db, 't-live')).toBe(2);
    expect(db.sync_changes).toHaveLength(0);
  });
});

describe('sync entity creates: boundary-guarded inserts (cached entity count)', () => {
  /**
   * The entity-quota count is read ONCE per sync (cached headroom); only the
   * BOUNDARY create — the create that would exactly consume the final pre-read
   * slot — keeps the atomic guarded INSERT. These tests pin that shape via the
   * generated SQL and its execution-time behavior on the shared harness.
   */

  /** Wrap a harness env so every prepared task INSERT's SQL is recorded. */
  function envRecordingInserts(
    base: Env
  ): { env: Env; inserts: string[] } {
    const d1 = base.D1_DATABASE;
    const inserts: string[] = [];
    const env = {
      ...base,
      D1_DATABASE: {
        prepare: (sql: string) => {
          if (/^INSERT INTO tasks\b/.test(sql)) inserts.push(sql);
          return d1.prepare(sql);
        },
        batch: (stmts: Parameters<typeof d1.batch>[0]) => d1.batch(stmts),
      },
    } as unknown as Env;
    return { env, inserts };
  }

  it('within-headroom creates apply with only the boundary INSERT embedding the quota guard', async () => {
    const { db, env: base } = editorDb(5); // 2 live entities → headroom 3
    const { env, inserts } = envRecordingInserts(base);

    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        createMutation('t-a', 'cm-1'),
        createMutation('t-b', 'cm-2'),
        createMutation('t-c', 'cm-3'),
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcomes: SyncMutationOutcome[] };
    expect(body.outcomes.map((o) => o.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);

    // Exactly ONE create INSERT carries the 5-table COUNT guard (`+ ? <= ?`):
    // the boundary (third) create, which consumes the final pre-read slot.
    // The earlier creates are plain INSERTs — no embedded COUNT re-executed.
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).not.toContain('+ ? <= ?');
    expect(inserts[1]).not.toContain('+ ? <= ?');
    expect(inserts[2]).toContain('+ ? <= ?');

    // All three committed, dependents included.
    for (const id of ['t-a', 't-b', 't-c']) {
      expect(db.tasks.some((t) => t.id === id)).toBe(true);
      expect(versionOf(db, id)).toBe(1);
    }
    expect(db.sync_changes.filter((c) => c.operation === 'create')).toHaveLength(
      3
    );
  });

  it('overflow beyond the cached headroom still ends in the structured 403', async () => {
    const { db, env: base } = editorDb(4); // 2 live entities → headroom 2
    const { env, inserts } = envRecordingInserts(base);

    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        createMutation('t-a', 'cm-1'),
        createMutation('t-b', 'cm-2'),
        createMutation('t-c', 'cm-3'),
      ],
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 4 entities');

    // The boundary create (second) carried the guard and committed; the third
    // was refused by the in-memory loop bound and left no trace.
    expect(inserts[1]).toContain('+ ? <= ?');
    expect(db.tasks.some((t) => t.id === 't-c')).toBe(false);
    expect(db.sync_changes.some((c) => c.entity_id === 't-c')).toBe(false);
    expect(versionOf(db, 't-c')).toBeUndefined();
  });

  it('a boundary guard that trips at execution time commits nothing for that create', async () => {
    const { db, env: base } = editorDb(3); // live 2 → TRUE headroom 1
    // Simulate the lost race the boundary guard exists for: the up-front
    // headroom read returns a stale optimistic count (as if the project were
    // empty), while the boundary INSERT's embedded guard re-evaluates the REAL
    // live total at execution time.
    const d1 = base.D1_DATABASE;
    const env = {
      ...base,
      D1_DATABASE: {
        prepare: (sql: string) => {
          if (/SELECT\s+\(SELECT COUNT\(\*\) FROM collections/.test(sql)) {
            return {
              bind: () => ({
                first: async () => ({ n: 0 }),
                all: async () => ({ results: [{ n: 0 }] }),
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

    const res = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [createMutation('t-a', 'cm-1'), createMutation('t-b', 'cm-2')],
    });

    // The stale pre-read claimed headroom 3, so both creates were built and
    // the second is the boundary create. At execution: t-a (plain) commits,
    // then the boundary guard re-counts the live total (now 3) and trips
    // (3 + 1 > 3) — the lost race is refused with the structured 403.
    expect(res.status).toBe(403);
    const body = (await res.json()) as QuotaErrorBody;
    expect(body.error.message).toContain('maximum of 3 entities');

    // The create within the pre-read capacity stays committed...
    expect(db.tasks.some((t) => t.id === 't-a')).toBe(true);
    expect(
      db.sync_changes.some(
        (c) => c.entity_id === 't-a' && c.operation === 'create'
      )
    ).toBe(true);
    // ...the blocked boundary create left NO trace at all.
    expect(db.tasks.some((t) => t.id === 't-b')).toBe(false);
    expect(db.sync_changes.some((c) => c.entity_id === 't-b')).toBe(false);
    expect(versionOf(db, 't-b')).toBeUndefined();
  });
});
