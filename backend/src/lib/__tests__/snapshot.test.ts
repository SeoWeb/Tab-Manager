import { describe, it, expect } from 'vitest';
import { getProjectSnapshot, requireProjectAccess } from '../projects';
import { forbidden } from '../response';
import type { Env, Role } from '../../types';

interface MockData {
  collections: any[];
  links: any[];
  tasks: any[];
  notes: any[];
  todos: any[];
  project_members: any[];
  users: any[];
  entity_versions: any[];
}

const NOW = '2020-01-01T00:00:00.000Z';
const LATER = '2021-01-01T00:00:00.000Z';

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
  if (sql.includes('FROM project_members')) {
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

  const tableMap: Record<string, keyof MockData> = {
    'FROM collections t': 'collections',
    'FROM links t': 'links',
    'FROM tasks t': 'tasks',
    'FROM notes t': 'notes',
    'FROM todos t': 'todos',
  };

  for (const [needle, table] of Object.entries(tableMap)) {
    if (!sql.includes(needle)) continue;
    const projectId = params[1];
    return (data[table] as any[])
      .filter((r) => r.project_id === projectId)
      .map((r) => ({
        ...r,
        version:
          data.entity_versions.find((ev) => ev.entity_id === r.id)?.version ?? 1,
      }));
  }

  return [];
}

function baseData(): MockData {
  return {
    collections: [
      {
        id: 'c-live',
        project_id: 'p1',
        name: 'Live',
        description: null,
        color: null,
        minimized: 0,
        order_index: 0,
        bookmark_folder_id: null,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: null,
      },
      {
        id: 'c-deleted',
        project_id: 'p1',
        name: 'Deleted',
        description: null,
        color: null,
        minimized: 0,
        order_index: 1,
        bookmark_folder_id: null,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: LATER,
      },
    ],
    links: [
      {
        id: 'l1',
        project_id: 'p1',
        collection_id: 'c-live',
        url: 'https://example.com',
        title: 'Example',
        fav_icon_url: null,
        notes: null,
        tags_json: null,
        order_index: 0,
        bookmark_id: null,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: null,
      },
    ],
    tasks: [
      {
        id: 't1',
        project_id: 'p1',
        collection_id: 'c-live',
        title: 'Task',
        payload_json: '{}',
        order_index: 0,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: null,
      },
    ],
    notes: [
      {
        id: 'n1',
        project_id: 'p1',
        collection_id: 'c-live',
        title: 'Note',
        payload_json: '{}',
        order_index: 0,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: null,
      },
    ],
    todos: [
      {
        id: 'd1',
        project_id: 'p1',
        collection_id: 'c-live',
        title: 'Todo',
        payload_json: '{}',
        order_index: 0,
        created_at: NOW,
        updated_at: LATER,
        deleted_at: null,
      },
    ],
    project_members: [
      { id: 'pm-owner', project_id: 'p1', user_id: 'u-owner', role: 'owner', created_at: NOW, updated_at: NOW },
      { id: 'pm-viewer', project_id: 'p1', user_id: 'u-viewer', role: 'viewer', created_at: NOW, updated_at: NOW },
    ],
    users: [
      { id: 'u-owner', email: 'owner@example.com', display_name: 'Owner' },
      { id: 'u-viewer', email: 'viewer@example.com', display_name: 'Viewer' },
    ],
    entity_versions: [
      { project_id: 'p1', entity_type: 'collection', entity_id: 'c-live', version: 4, updated_at: LATER },
      { project_id: 'p1', entity_type: 'collection', entity_id: 'c-deleted', version: 2, updated_at: LATER },
      { project_id: 'p1', entity_type: 'link', entity_id: 'l1', version: 3, updated_at: LATER },
      { project_id: 'p1', entity_type: 'task', entity_id: 't1', version: 1, updated_at: LATER },
    ],
  };
}

describe('getProjectSnapshot', () => {
  it('includes soft-deleted entities in the snapshot', async () => {
    const env = makeEnv(baseData());
    const snapshot = await getProjectSnapshot(env, 'p1');

    const deleted = snapshot.collections.find((c) => c.id === 'c-deleted');
    expect(deleted).toBeDefined();
    expect(deleted?.deleted_at).not.toBeNull();
  });

  it('attaches version from entity_versions to each entity', async () => {
    const env = makeEnv(baseData());
    const snapshot = await getProjectSnapshot(env, 'p1');

    expect(snapshot.collections.find((c) => c.id === 'c-live')?.version).toBe(4);
    expect(snapshot.collections.find((c) => c.id === 'c-deleted')?.version).toBe(2);
    expect(snapshot.links[0]?.version).toBe(3);
  });

  it('returns the five entity arrays for the project', async () => {
    const env = makeEnv(baseData());
    const snapshot = await getProjectSnapshot(env, 'p1');

    expect(snapshot.collections).toHaveLength(2);
    expect(snapshot.links).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.notes).toHaveLength(1);
    expect(snapshot.todos).toHaveLength(1);
  });

  it('defaults version to 1 when no entity_versions row exists', async () => {
    const env = makeEnv(baseData());
    const snapshot = await getProjectSnapshot(env, 'p1');
    // tasks/n1/d1 have no explicit version row in baseData
    expect(snapshot.tasks[0]?.version).toBe(1);
    expect(snapshot.notes[0]?.version).toBe(1);
    expect(snapshot.todos[0]?.version).toBe(1);
  });
});

describe('snapshot access control', () => {
  it('denies non-members (returns a forbidden Response)', async () => {
    const data = baseData();
    const env = makeEnv(data);
    const result = await requireProjectAccess(env, 'u-stranger', 'p1', 'viewer');
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(403);
    }
  });

  it('allows a viewer to read and returns the snapshot', async () => {
    const data = baseData();
    const env = makeEnv(data);
    const access = await requireProjectAccess(env, 'u-viewer', 'p1', 'viewer');
    expect(access).not.toBeInstanceOf(Response);
    if (!(access instanceof Response)) {
      expect((access as { role: Role }).role).toBe('viewer');
    }

    const snapshot = await getProjectSnapshot(env, 'p1');
    expect(snapshot.collections.length).toBeGreaterThan(0);
  });
});
