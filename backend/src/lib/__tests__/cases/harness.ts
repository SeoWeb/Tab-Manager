import type { Env, SyncMutation } from '../../../types';

export type { Env };

// Shared in-memory D1 mock + fixtures for soft-delete basis reconciliation
// (Option A: "soft-deleted = not present"). Used by the `cases/*.test.ts`
// suites that exercise applyMutation against a soft-deleted entity.

export const NOW = '2020-01-01T00:00:00.000Z';
export const DELETED_AT = '2021-01-01T00:00:00.000Z';

export interface Row {
  id: string;
  project_id: string;
  deleted_at: string | null;
  [k: string]: unknown;
}

export interface VersionRow {
  project_id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  updated_at: string;
}

export interface ChangeRow {
  client_mutation_id: string | null;
  entity_id: string;
  operation: string;
  [k: string]: unknown;
}

export interface DB {
  collections: Row[];
  links: Row[];
  tasks: Row[];
  notes: Row[];
  todos: Row[];
  projects: Row[];
  project_members: { project_id: string; user_id: string; role: string }[];
  entity_versions: VersionRow[];
  sync_changes: ChangeRow[];
}

const ENTITY_TABLES = [
  'collections',
  'links',
  'tasks',
  'notes',
  'todos',
  'projects',
] as const;

function tableInSql(sql: string): keyof DB | null {
  for (const t of ENTITY_TABLES) {
    // Match "FROM <t>", "UPDATE <t>", "INTO <t>" as whole words.
    if (new RegExp(`\\b${t}\\b`).test(sql)) return t;
  }
  return null;
}

/** Minimal D1 mock covering the SQL shapes applyMutation issues. */
export function makeEnv(db: DB): Env {
  function run(sql: string, params: unknown[]) {
    // INSERT into sync_changes (idempotency log + change rows).
    if (/INSERT INTO sync_changes/.test(sql)) {
      // Columns: change_id, project_id, actor_id, entity_type, entity_id,
      // operation, patch_json, base_version, client_mutation_id, client_id,
      // created_at
      db.sync_changes.push({
        entity_id: params[4] as string,
        operation: params[5] as string,
        client_mutation_id: (params[8] as string | null) ?? null,
      });
      return { meta: { changes: 1 } };
    }

    // Version upsert.
    if (/INSERT INTO entity_versions/.test(sql)) {
      const [projectId, entityType, entityId, , updatedAt] = params as [
        string,
        string,
        string,
        number,
        string,
      ];
      const existing = db.entity_versions.find(
        (v) =>
          v.project_id === projectId &&
          v.entity_type === entityType &&
          v.entity_id === entityId
      );
      if (existing) {
        existing.version += 1;
        existing.updated_at = updatedAt;
      } else {
        db.entity_versions.push({
          project_id: projectId,
          entity_type: entityType,
          entity_id: entityId,
          version: 1,
          updated_at: updatedAt,
        });
      }
      return { meta: { changes: 1 } };
    }

    // Soft-delete / update writes: only affect live rows (deleted_at IS NULL).
    if (/^\s*UPDATE/.test(sql)) {
      const table = tableInSql(sql);
      if (!table) return { meta: { changes: 0 } };
      const id = params[params.length - 1] as string;
      const rows = db[table] as Row[];
      const target = rows.find((r) => r.id === id && r.deleted_at === null);
      if (!target) return { meta: { changes: 0 } };
      if (/SET deleted_at = \?/.test(sql)) {
        target.deleted_at = params[0] as string;
      }
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }

  function first(sql: string, params: unknown[]): unknown {
    // Idempotency check.
    if (/SELECT id FROM sync_changes WHERE client_mutation_id/.test(sql)) {
      const cmid = params[0];
      const hit = db.sync_changes.find((c) => c.client_mutation_id === cmid);
      return hit ? { id: 1 } : null;
    }

    // Entity version lookup.
    if (/SELECT version FROM entity_versions/.test(sql)) {
      const [projectId, entityType, entityId] = params as [
        string,
        string,
        string,
      ];
      const v = db.entity_versions.find(
        (x) =>
          x.project_id === projectId &&
          x.entity_type === entityType &&
          x.entity_id === entityId
      );
      return v ? { version: v.version } : null;
    }

    // Membership role.
    if (/SELECT role FROM project_members/.test(sql)) {
      const [projectId, userId] = params as [string, string];
      const m = db.project_members.find(
        (x) => x.project_id === projectId && x.user_id === userId
      );
      return m ? { role: m.role } : null;
    }

    // Member count.
    if (/COUNT\(\*\) AS n FROM project_members/.test(sql)) {
      const projectId = params[0] as string;
      const n = db.project_members.filter(
        (x) => x.project_id === projectId
      ).length;
      return { n };
    }

    // Live-row reads (existence + current-row merge + move project_id).
    if (/deleted_at IS NULL/.test(sql)) {
      const table = tableInSql(sql);
      if (!table) return null;
      const id = params[0] as string;
      const row = (db[table] as Row[]).find(
        (r) => r.id === id && r.deleted_at === null
      );
      return row ?? null;
    }

    return null;
  }

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              return first(sql, params);
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return run(sql, params);
            },
            // Marker used by batch() to replay the statement.
            __exec: () => run(sql, params),
          };
        },
      };
    },
    async batch(stmts: { __exec: () => unknown }[]) {
      return stmts.map((s) => s.__exec());
    },
  };

  return { D1_DATABASE: database } as unknown as Env;
}

export function baseDb(): DB {
  return {
    collections: [
      { id: 'c-live', project_id: 'p1', name: 'Live', deleted_at: null },
      {
        id: 'c-dead',
        project_id: 'p1',
        name: 'Dead',
        deleted_at: DELETED_AT,
      },
    ],
    links: [],
    tasks: [
      {
        id: 't-live',
        project_id: 'p1',
        collection_id: 'c-live',
        title: 'Task',
        payload_json: '{}',
        order_index: 0,
        deleted_at: null,
      },
      {
        id: 't-dead',
        project_id: 'p1',
        collection_id: 'c-live',
        title: 'Dead task',
        payload_json: '{}',
        order_index: 0,
        deleted_at: DELETED_AT,
      },
    ],
    notes: [],
    todos: [],
    projects: [
      { id: 'p1', project_id: 'p1', name: 'Project', deleted_at: null },
      {
        id: 'p-dead',
        project_id: 'p-dead',
        name: 'Dead project',
        deleted_at: DELETED_AT,
      },
    ],
    project_members: [{ project_id: 'p-dead', user_id: 'u1', role: 'owner' }],
    entity_versions: [
      {
        project_id: 'p1',
        entity_type: 'collection',
        entity_id: 'c-dead',
        version: 5,
        updated_at: DELETED_AT,
      },
      {
        project_id: 'p1',
        entity_type: 'task',
        entity_id: 't-live',
        version: 2,
        updated_at: NOW,
      },
      {
        project_id: 'p1',
        entity_type: 'task',
        entity_id: 't-dead',
        version: 7,
        updated_at: DELETED_AT,
      },
      {
        project_id: 'p-dead',
        entity_type: 'project',
        entity_id: 'p-dead',
        version: 3,
        updated_at: DELETED_AT,
      },
    ],
    sync_changes: [],
  };
}

export function versionOf(db: DB, entityId: string): number | undefined {
  return db.entity_versions.find((v) => v.entity_id === entityId)?.version;
}

export function mutation(overrides: Partial<SyncMutation>): SyncMutation {
  return {
    clientMutationId: `cm-${Math.random().toString(36).slice(2)}`,
    entityType: 'task',
    entityId: 't-live',
    projectId: 'p1',
    operation: 'update',
    patch: {},
    clientId: 'client-1',
    createdAt: NOW,
    ...overrides,
  } as SyncMutation;
}
