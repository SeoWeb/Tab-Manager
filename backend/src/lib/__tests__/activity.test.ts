import { describe, it, expect } from 'vitest';
import { getActivity } from '../projects';
import type { Env } from '../../types';

interface MockData {
  sync_changes: any[];
  users: any[];
  project_members: any[];
}

const NOW = '2020-01-01T00:00:00.000Z';

function makeEnv(data: MockData): Env {
  const db = {
    prepare(sql: string) {
      const stmt = {
        _sql: sql,
        bind(...params: any[]) {
          return {
            _sql: sql,
            _params: params,
            async all() {
              return { results: execSelect(sql, params, data) };
            },
            async first() {
              return execSelect(sql, params, data)[0] ?? null;
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      };
      return stmt;
    },
  };
  return { D1_DATABASE: db } as unknown as Env;
}

function execSelect(sql: string, params: any[], data: MockData): any[] {
  // Membership lookup used by requireProjectAccess → getProjectMember.
  if (sql.includes('FROM project_members pm')) {
    const [projectId, userId] = params;
    const m = data.project_members.find(
      (pm) => pm.project_id === projectId && pm.user_id === userId
    );
    if (!m) return [];
    const u = data.users.find((u) => u.id === userId);
    return [
      {
        ...m,
        email: u?.email ?? null,
        display_name: u?.display_name ?? null,
      },
    ];
  }

  // Activity log with the LEFT JOIN to users for actor identity.
  if (sql.includes('FROM sync_changes')) {
    const [projectId, limit] = params;
    return data.sync_changes
      .filter((c) => c.project_id === projectId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((c) => {
        const u = data.users.find((u) => u.id === c.actor_id);
        return {
          ...c,
          actor_email: u ? u.email : null,
          actor_display_name: u ? u.display_name : null,
        };
      });
  }

  return [];
}

const alice = {
  id: 'u-alice',
  email: 'alice@example.com',
  display_name: 'Alice',
};
const bob = { id: 'u-bob', email: 'bob@example.com', display_name: null };

describe('getActivity', () => {
  const data: MockData = {
    users: [alice, bob],
    project_members: [
      { id: 'pm-1', project_id: 'p1', user_id: 'u-alice', role: 'owner' },
    ],
    sync_changes: [
      {
        id: 2,
        change_id: 'ch-2',
        project_id: 'p1',
        actor_id: 'u-bob',
        entity_type: 'link',
        entity_id: 'l1',
        operation: 'update',
        patch_json: null,
        base_version: 1,
        client_mutation_id: 'cm-1',
        client_id: 'c-1',
        created_at: NOW,
      },
      {
        id: 1,
        change_id: 'ch-1',
        project_id: 'p1',
        actor_id: 'u-alice',
        entity_type: 'collection',
        entity_id: 'c1',
        operation: 'create',
        patch_json: null,
        base_version: null,
        client_mutation_id: null,
        client_id: null,
        created_at: NOW,
      },
    ],
  };

  it('enriches each change with the actor display name and email', async () => {
    const env = makeEnv(data);
    const res = await getActivity(env, { id: 'u-alice' }, 'p1', 100);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: any[] };
    expect(body.changes).toHaveLength(2);

    // Most recent first.
    expect(body.changes[0].id).toBe(2);
    expect(body.changes[0].actor_id).toBe('u-bob');
    expect(body.changes[0].actor_display_name).toBeNull(); // Bob has no display name
    expect(body.changes[0].actor_email).toBe('bob@example.com');

    expect(body.changes[1].actor_id).toBe('u-alice');
    expect(body.changes[1].actor_display_name).toBe('Alice');
    expect(body.changes[1].actor_email).toBe('alice@example.com');
  });

  it('returns 403 for a user without project access', async () => {
    const env = makeEnv({ ...data, project_members: [] });
    const res = await getActivity(env, { id: 'u-stranger' }, 'p1', 100);
    expect(res.status).toBe(403);
  });
});
