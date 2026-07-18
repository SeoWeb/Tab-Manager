import { describe, it, expect } from 'vitest';
import { checkProjectQuota, checkMemberQuota } from '../quotas';
import type { Env } from '../../types';
import type { D1PreparedStatement } from '@cloudflare/workers-types';

/**
 * A tiny in-memory D1 mock focused on the quota functions. It tracks project
 * counts per owner and member counts per project, and — crucially — evaluates
 * the guarded `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < limit`
 * statements at *batch execution time* under a serial lock, so concurrent
 * requests observe committed state and cannot both win the final slot.
 */
class MockD1 {
  projects: { id: string; owner_id: string; deleted_at: string | null }[] = [];
  members: { project_id: string; user_id: string }[] = [];
  private lock: Promise<unknown> = Promise.resolve();

  private countProjects(ownerId: string): number {
    return this.projects.filter(
      (p) => p.owner_id === ownerId && p.deleted_at === null
    ).length;
  }

  private countMembers(projectId: string): number {
    return this.members.filter((m) => m.project_id === projectId).length;
  }

  prepare(sql: string): D1PreparedStatement {
    const self = this;
    return {
      bind: (...args: unknown[]) => ({
        sql,
        args,
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM projects WHERE owner_id')) {
            const ownerId = args[0] as string;
            return { n: self.countProjects(ownerId) } as unknown as T;
          }
          if (sql.includes('FROM project_members WHERE project_id')) {
            const projectId = args[0] as string;
            return { n: self.countMembers(projectId) } as unknown as T;
          }
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      }),
    } as unknown as D1PreparedStatement;
  }

  async batch(
    statements: D1PreparedStatement[]
  ): Promise<{ meta: { changes: number } }[]> {
    // Serialize batches so concurrent transactions observe committed state.
    const run = this.lock.then(() => {
      return statements.map((stmt) => {
        const { sql, args } = stmt as unknown as {
          sql: string;
          args: unknown[];
        };
        if (sql.startsWith('INSERT INTO projects')) {
          // Guarded form trailing args are [ownerId, limit].
          const limit = args[args.length - 1] as number;
          const ownerId = args[args.length - 2] as string;
          if (this.countProjects(ownerId) < limit) {
            this.projects.push({
              id: `p-${this.projects.length}`,
              owner_id: ownerId,
              deleted_at: null,
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('INSERT INTO project_members')) {
          const limit = args[args.length - 1] as number;
          const projectId = args[args.length - 2] as string;
          if (this.countMembers(projectId) < limit) {
            this.members.push({
              project_id: projectId,
              user_id: `u-${this.members.length}`,
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: 1 } };
      });
    });
    this.lock = run.catch(() => {});
    return run;
  }
}

function makeEnv(): Env {
  const db = new MockD1();
  return { D1_DATABASE: db as unknown as Env['D1_DATABASE'] } as Env;
}

/** Build a guarded project insert statement (matches projects.ts shape). */
function projectInsert(env: Env, ownerId: string, limit: number) {
  return (env.D1_DATABASE as unknown as MockD1)
    .prepare(
      'INSERT INTO projects (id, name, owner_id, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id = ? AND deleted_at IS NULL) < ?'
    )
    .bind(
      `pid-${Math.random()}`,
      'name',
      ownerId,
      'now',
      'now',
      ownerId,
      limit
    ) as unknown as D1PreparedStatement;
}

/** Build a guarded member insert statement (matches projects.ts shape). */
function memberInsert(env: Env, projectId: string, limit: number) {
  return (env.D1_DATABASE as unknown as MockD1)
    .prepare(
      'INSERT INTO project_members (id, project_id, user_id) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM project_members WHERE project_id = ?) < ?'
    )
    .bind('m', projectId, 'u', projectId, limit) as unknown as D1PreparedStatement;
}

describe('checkProjectQuota concurrency', () => {
  it('lets at most one concurrent create win the final slot', async () => {
    const env = makeEnv();
    const owner = 'owner-1';
    const limit = 10;
    const db = env.D1_DATABASE as unknown as MockD1;
    for (let i = 0; i < 9; i++) {
      db.projects.push({ id: `seed-${i}`, owner_id: owner, deleted_at: null });
    }

    // Two concurrent creates, both observing 9 < 10 before either commits.
    const results = await Promise.all([
      checkProjectQuota(env, owner, { primary: projectInsert(env, owner, limit) }),
      checkProjectQuota(env, owner, { primary: projectInsert(env, owner, limit) }),
    ]);

    const allowed = results.filter((r) => r === null).length;
    const denied = results.filter((r) => r !== null).length;
    expect(allowed).toBe(1);
    expect(denied).toBe(1);
    const deniedResponse = results.find((r) => r !== null) as Response;
    expect(deniedResponse.status).toBe(403);
    expect(db.projects.filter((p) => p.owner_id === owner).length).toBe(10);
  });

  it('allows a single create when under the limit', async () => {
    const env = makeEnv();
    const result = await checkProjectQuota(env, 'owner-2', {
      primary: projectInsert(env, 'owner-2', 10),
    });
    expect(result).toBeNull();
  });
});

describe('checkMemberQuota concurrency', () => {
  it('lets at most one concurrent invite win the final slot', async () => {
    const env = makeEnv();
    const project = 'project-1';
    const limit = 50;
    const db = env.D1_DATABASE as unknown as MockD1;
    for (let i = 0; i < 49; i++) {
      db.members.push({ project_id: project, user_id: `seed-${i}` });
    }

    const results = await Promise.all([
      checkMemberQuota(env, project, { primary: memberInsert(env, project, limit) }),
      checkMemberQuota(env, project, { primary: memberInsert(env, project, limit) }),
    ]);

    const allowed = results.filter((r) => r === null).length;
    expect(allowed).toBe(1);
    expect(db.members.filter((m) => m.project_id === project).length).toBe(50);
  });
});
