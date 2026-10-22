import type { Env, SyncMutation } from '../../../types';

export type { Env };

// Shared in-memory D1 mock + fixtures for the sync mutation engine. Used by the
// `cases/*.test.ts` suites, the sync engine suites that exercise
// applyMutation / syncProject, and the quota suites that exercise createProject
// / acceptInvitation end to end.
//
// The mock models the real constraints the engine relies on:
// - UNIQUE(project_id, client_mutation_id) on sync_changes (migration 0004);
// - UNIQUE(id) on every table and UNIQUE(project_id, user_id) on
//   project_members;
// - the FOREIGN KEYs projects.owner_id → users.id, project_members.project_id /
//   invitations.project_id → projects.id, invitations.created_by → users.id
//   (violations throw, like D1);
// - the quota guards (`INSERT ... SELECT ... WHERE (count) < limit` and the
//   entity-total guard on create inserts) evaluate against live committed
//   state, so a tripped guard reports `meta.changes: 0`;
// - D1 batch atomicity (a throwing statement rolls the whole batch back);
// - the version-guard (`AND (SELECT version ...) = ?`) on CAS writes.
//
// Batched statements still run unconditionally in sequence (real D1 semantics:
// a statement inserting 0 rows does NOT abort the batch), which is exactly why
// the production code must keep dependents out of a guard batch.

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
  id: number;
  project_id: string;
  entity_id: string;
  operation: string;
  client_mutation_id: string | null;
  [k: string]: unknown;
}

export interface InvitationRow {
  id: string;
  project_id: string;
  code: string;
  email: string | null;
  role: string;
  created_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface DB {
  collections: Row[];
  links: Row[];
  tasks: Row[];
  notes: Row[];
  todos: Row[];
  projects: Row[];
  users: { id: string; email: string }[];
  project_members: { project_id: string; user_id: string; role: string }[];
  invitations: InvitationRow[];
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

/** Shape of the shared version-guard predicate appended to CAS writes. The
 * predicate is the entire WHERE clause on guarded changelog INSERTs and an
 * AND-ed condition on guarded UPDATEs, so the leading keyword is not part of
 * the pattern. */
const GUARD_MATCH =
  /\(SELECT version FROM entity_versions WHERE project_id = \? AND entity_type = \? AND entity_id = \?\) = \?/;

function findVersion(
  db: DB,
  projectId: unknown,
  entityType: unknown,
  entityId: unknown
): VersionRow | undefined {
  return db.entity_versions.find(
    (v) =>
      v.project_id === projectId &&
      v.entity_type === entityType &&
      v.entity_id === entityId
  );
}

/** Minimal D1 mock covering the SQL shapes applyMutation issues. */
export function makeEnv(db: DB, vars: Record<string, string> = {}): Env {
  function run(sql: string, params: unknown[]) {
    // Project creates (plain or quota-guarded INSERT ... SELECT ... WHERE).
    if (/^\s*INSERT INTO projects\b/.test(sql)) {
      // Quota guard: trailing bindings are [ownerId, limit].
      if (
        /SELECT COUNT\(\*\) FROM projects WHERE owner_id = \? AND deleted_at IS NULL\s*\) < \?/.test(
          sql
        )
      ) {
        const [ownerId, limit] = params.slice(params.length - 2) as [
          string,
          number,
        ];
        const live = db.projects.filter(
          (p) => p.owner_id === ownerId && p.deleted_at === null
        ).length;
        if (live >= limit) return { meta: { changes: 0 } };
      }
      const colsMatch = sql.match(/INSERT INTO projects \(([^)]+)\)/);
      if (!colsMatch) return { meta: { changes: 0 } };
      const cols = colsMatch[1].split(',').map((c) => c.trim());
      const row = { deleted_at: null } as Row;
      cols.forEach((col, i) => {
        row[col] = params[i];
      });
      if (db.projects.some((r) => r.id === row.id)) {
        throw new Error('UNIQUE constraint failed: projects.id');
      }
      // FK (owner_id) REFERENCES users(id).
      if (!db.users.some((u) => u.id === row.owner_id)) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      db.projects.push(row);
      return { meta: { changes: 1 } };
    }

    // Membership inserts (owner seed, invitation acceptance). The guarded form
    // carries `WHERE (SELECT COUNT(*) FROM project_members WHERE project_id = ?) < ?`.
    if (/^\s*INSERT INTO project_members\b/.test(sql)) {
      if (
        /SELECT COUNT\(\*\) FROM project_members WHERE project_id = \?\s*\) < \?/.test(
          sql
        )
      ) {
        const [projectId, limit] = params.slice(params.length - 2) as [
          string,
          number,
        ];
        const n = db.project_members.filter(
          (m) => m.project_id === projectId
        ).length;
        if (n >= limit) return { meta: { changes: 0 } };
      }
      const colsMatch = sql.match(/INSERT INTO project_members \(([^)]+)\)/);
      if (!colsMatch) return { meta: { changes: 0 } };
      const cols = colsMatch[1].split(',').map((c) => c.trim());
      const row = {} as Row;
      cols.forEach((col, i) => {
        row[col] = params[i];
      });
      // FK (project_id) REFERENCES projects(id).
      if (!db.projects.some((p) => p.id === row.project_id)) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      // UNIQUE (project_id, user_id).
      if (
        db.project_members.some(
          (m) =>
            m.project_id === row.project_id && m.user_id === row.user_id
        )
      ) {
        throw new Error(
          'UNIQUE constraint failed: project_members.project_id, project_members.user_id'
        );
      }
      db.project_members.push({
        project_id: row.project_id as string,
        user_id: row.user_id as string,
        role: row.role as string,
      });
      return { meta: { changes: 1 } };
    }

    // Invitation creates (guarded by the member count, like acceptInvitation's
    // membership insert).
    if (/^\s*INSERT INTO invitations\b/.test(sql)) {
      if (
        /SELECT COUNT\(\*\) FROM project_members WHERE project_id = \?\s*\) < \?/.test(
          sql
        )
      ) {
        const [projectId, limit] = params.slice(params.length - 2) as [
          string,
          number,
        ];
        const n = db.project_members.filter(
          (m) => m.project_id === projectId
        ).length;
        if (n >= limit) return { meta: { changes: 0 } };
      }
      const colsMatch = sql.match(/INSERT INTO invitations \(([^)]+)\)/);
      if (!colsMatch) return { meta: { changes: 0 } };
      const cols = colsMatch[1].split(',').map((c) => c.trim());
      const row = {} as InvitationRow;
      cols.forEach((col, i) => {
        row[col as keyof InvitationRow] = params[i] as never;
      });
      // FK (project_id) REFERENCES projects(id), (created_by) REFERENCES users(id).
      if (!db.projects.some((p) => p.id === row.project_id)) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      if (!db.users.some((u) => u.id === row.created_by)) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      if (db.invitations.some((i) => i.code === row.code)) {
        throw new Error('UNIQUE constraint failed: invitations.code');
      }
      db.invitations.push(row);
      return { meta: { changes: 1 } };
    }

    // Invitation acceptance: UPDATE invitations SET accepted_at = ? WHERE id = ?.
    // (Handled before the generic UPDATE branch, which expects the
    // project-scoped `WHERE id = ? AND project_id = ?` shape.)
    if (/^\s*UPDATE invitations\b/.test(sql)) {
      const [acceptedAt, id] = params as [string, string];
      const invite = db.invitations.find((i) => i.id === id);
      if (!invite) return { meta: { changes: 0 } };
      invite.accepted_at = acceptedAt;
      return { meta: { changes: 1 } };
    }

    // Entity creates (plain or quota-guarded INSERT ... SELECT ... WHERE).
    // Materializes the row so tests can assert "created exactly once", and
    // models the global id PRIMARY KEY (a colliding id throws).
    if (/^INSERT INTO (collections|links|tasks|notes|todos)\b/.test(sql)) {
      // Read the target table from the INSERT clause itself: the quota guard
      // subquery mentions every entity table, so generic name-matching would
      // misroute the statement.
      const table = sql.match(
        /^INSERT INTO (collections|links|tasks|notes|todos)\b/
      )![1] as keyof DB;
      // Quota guard: trailing bindings are (projectId ×5, createCount, max).
      if (sql.includes('+ ? <= ?')) {
        const [count, max] = params.slice(params.length - 2) as [number, number];
        const guardProjectId = params[params.length - 7] as string;
        const live = ENTITY_TABLES.filter((t) => t !== 'projects').reduce(
          (sum, t) =>
            sum +
            (db[t] as Row[]).filter(
              (r) =>
                r.project_id === guardProjectId && r.deleted_at === null
            ).length,
          0
        );
        if (live + count > max) return { meta: { changes: 0 } };
      }
      const colsMatch = sql.match(/INSERT INTO \w+ \(([^)]+)\)/);
      if (!colsMatch) return { meta: { changes: 0 } };
      const cols = colsMatch[1].split(',').map((c) => c.trim());
      const values = params.slice(0, cols.length);
      const row = { deleted_at: null } as Row;
      cols.forEach((col, i) => {
        row[col] = values[i];
      });
      if (
        (db[table] as Row[]).some((r) => r.id === row.id)
      ) {
        throw new Error(`UNIQUE constraint failed: ${table}.id`);
      }
      (db[table] as Row[]).push(row);
      return { meta: { changes: 1 } };
    }

    // INSERT into sync_changes (idempotency log + change rows).
    if (/INSERT INTO sync_changes/.test(sql)) {
      // Version-guarded insert (CAS path): only commits while the entity's
      // version still equals the guarded baseVersion.
      if (GUARD_MATCH.test(sql)) {
        const [gProjectId, gEntityType, gEntityId, expected] = params.slice(
          params.length - 4
        ) as [string, string, string, number];
        const v = findVersion(db, gProjectId, gEntityType, gEntityId);
        if (!v || v.version !== expected) return { meta: { changes: 0 } };
      }
      // Columns: change_id, project_id, actor_id, entity_type, entity_id,
      // operation, patch_json, base_version, client_mutation_id, client_id,
      // created_at
      const projectId = params[1] as string;
      const clientMutationId = (params[8] as string | null) ?? null;
      // Model migration 0004's UNIQUE(project_id, client_mutation_id).
      if (
        clientMutationId !== null &&
        db.sync_changes.some(
          (c) =>
            c.project_id === projectId &&
            c.client_mutation_id === clientMutationId
        )
      ) {
        throw new Error(
          'UNIQUE constraint failed: sync_changes.project_id, sync_changes.client_mutation_id'
        );
      }
      db.sync_changes.push({
        id: db.sync_changes.length + 1,
        project_id: projectId,
        entity_id: params[4] as string,
        operation: params[5] as string,
        client_mutation_id: clientMutationId,
      });
      return { meta: { changes: 1 } };
    }

    // Legacy/create version upsert.
    if (/INSERT INTO entity_versions/.test(sql)) {
      const [projectId, entityType, entityId, , updatedAt] = params as [
        string,
        string,
        string,
        number,
        string,
      ];
      const existing = findVersion(db, projectId, entityType, entityId);
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

    // CAS version bump: version = version + 1 WHERE ... AND version = expected.
    if (/UPDATE\s+entity_versions/.test(sql)) {
      const [, projectId, entityType, entityId, expected] = params as [
        string,
        string,
        string,
        string,
        number,
      ];
      const v = findVersion(db, projectId, entityType, entityId);
      if (!v || v.version !== expected) return { meta: { changes: 0 } };
      v.version += 1;
      v.updated_at = params[0] as string;
      return { meta: { changes: 1 } };
    }

    // Soft-delete / update writes. Every write is scoped by `project_id`, and
    // CAS writes additionally by the entity's current version. The SET list is
    // applied generically so tests can assert exactly what changed.
    if (/^\s*UPDATE/.test(sql)) {
      const table = tableInSql(sql);
      if (!table) return { meta: { changes: 0 } };
      const whereIdx = sql.indexOf(' WHERE ');
      const setPart = sql.slice(0, whereIdx);
      const setCount = (setPart.match(/\?/g) ?? []).length;
      const setValues = params.slice(0, setCount);
      const whereParams = params.slice(setCount);

      let cursor = 0;
      const take = (n: number): unknown[] => {
        const v = whereParams.slice(cursor, cursor + n);
        cursor += n;
        return v;
      };
      // Parse the top-level WHERE clause condition by condition. Conditions
      // appear in a fixed order (the builders' templates): id, project_id,
      // optional deleted_at IS NULL, optional version guard.
      let rest = sql.slice(whereIdx);
      if (!rest.startsWith(' WHERE id = ?')) return { meta: { changes: 0 } };
      const id = take(1)[0] as string;
      rest = rest.slice(' WHERE id = ?'.length);
      if (!rest.startsWith(' AND project_id = ?')) {
        return { meta: { changes: 0 } };
      }
      const projectId = take(1)[0] as string;
      rest = rest.slice(' AND project_id = ?'.length);
      let requireLive = false;
      if (rest.startsWith(' AND deleted_at IS NULL')) {
        requireLive = true;
        rest = rest.slice(' AND deleted_at IS NULL'.length);
      }
      if (GUARD_MATCH.test(rest)) {
        const [gProjectId, gEntityType, gEntityId, expected] = take(4) as [
          string,
          string,
          string,
          number,
        ];
        const v = findVersion(db, gProjectId, gEntityType, gEntityId);
        if (!v || v.version !== expected) return { meta: { changes: 0 } };
      }

      const rows = db[table] as Row[];
      const target = rows.find(
        (r) =>
          r.id === id &&
          r.project_id === projectId &&
          (!requireLive || r.deleted_at === null)
      );
      if (!target) return { meta: { changes: 0 } };

      // Apply the SET list in order: "SET col = ?, col = ?".
      const cols = [...setPart.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(
        (m) => m[1]
      );
      cols.forEach((col, i) => {
        target[col] = setValues[i];
      });
      return { meta: { changes: 1 } };
    }

    // In-batch version read (statement 0 of a CAS batch).
    if (/SELECT version FROM entity_versions/.test(sql)) {
      const [projectId, entityType, entityId] = params as [
        string,
        string,
        string,
      ];
      const v = findVersion(db, projectId, entityType, entityId);
      return { results: v ? [{ version: v.version }] : [], meta: { changes: 0 } };
    }

    // In-batch idempotency dedupe read (applyMutation's folded read batch —
    // same shape as the `.first()` fast path in first()).
    if (
      /SELECT id FROM sync_changes WHERE project_id = \? AND client_mutation_id = \?/.test(
        sql
      )
    ) {
      const [projectId, cmid] = params as [string, string];
      const hit = db.sync_changes.find(
        (c) => c.project_id === projectId && c.client_mutation_id === cmid
      );
      return { results: hit ? [{ id: hit.id }] : [], meta: { changes: 0 } };
    }

    // In-batch project-scoped live-row existence read (applyMutation's folded
    // read batch — same shape as `entityExists`'s `.first()`).
    if (
      /^SELECT id FROM (collections|links|tasks|notes|todos) WHERE id = \? AND project_id = \? AND deleted_at IS NULL$/.test(
        sql.trim()
      )
    ) {
      const table = sql.trim().match(
        /^SELECT id FROM (collections|links|tasks|notes|todos) /
      )![1] as keyof DB;
      const [id, projectId] = params as [string, string];
      const row = (db[table] as Row[]).find(
        (r) =>
          r.id === id &&
          r.project_id === projectId &&
          r.deleted_at === null
      );
      return { results: row ? [{ id: row.id }] : [], meta: { changes: 0 } };
    }

    // In-batch current-row read (the batched apply path's folded pre-read —
    // the same statement shape the serial `prepareUpdate*` builders issue via
    // `.first()`): returns the full live row so the caller can merge fields.
    if (
      /^SELECT [\s\S]+ FROM (collections|links|tasks|notes|todos) WHERE id = \? AND project_id = \? AND deleted_at IS NULL$/.test(
        sql.trim()
      )
    ) {
      const table = sql.trim().match(
        /^SELECT [\s\S]+ FROM (collections|links|tasks|notes|todos) /
      )![1] as keyof DB;
      const [id, projectId] = params as [string, string];
      const row = (db[table] as Row[]).find(
        (r) =>
          r.id === id &&
          r.project_id === projectId &&
          r.deleted_at === null
      );
      return { results: row ? [row] : [], meta: { changes: 0 } };
    }

    return { meta: { changes: 0 } };
  }

  function first(sql: string, params: unknown[]): unknown {
    // Idempotency check — scoped to the project (migration 0004's replay key).
    if (
      /SELECT id FROM sync_changes WHERE project_id = \? AND client_mutation_id = \?/.test(
        sql
      )
    ) {
      const [projectId, cmid] = params as [string, string];
      const hit = db.sync_changes.find(
        (c) => c.project_id === projectId && c.client_mutation_id === cmid
      );
      return hit ? { id: hit.id } : null;
    }

    // Entity version lookup.
    if (/SELECT version FROM entity_versions/.test(sql)) {
      const [projectId, entityType, entityId] = params as [
        string,
        string,
        string,
      ];
      const v = findVersion(db, projectId, entityType, entityId);
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

    // Owned-project count (project quota read).
    if (/COUNT\(\*\) AS n FROM projects WHERE owner_id/.test(sql)) {
      const ownerId = params[0] as string;
      const n = db.projects.filter(
        (p) => p.owner_id === ownerId && p.deleted_at === null
      ).length;
      return { n };
    }

    // Member + user join (requireProjectAccess → getProjectMember).
    if (/FROM project_members pm\s+JOIN users u/.test(sql)) {
      const [projectId, userId] = params as [string, string];
      const m = db.project_members.find(
        (x) => x.project_id === projectId && x.user_id === userId
      );
      if (!m) return null;
      return {
        id: `pm-${userId}`,
        project_id: projectId,
        user_id: userId,
        role: m.role,
        created_at: NOW,
        updated_at: NOW,
        email: `${userId}@example.com`,
        display_name: null,
      };
    }

    // Total-entity count (quota read): five COUNT(*) subqueries AS n.
    if (/SELECT\s+\(SELECT COUNT\(\*\) FROM collections/.test(sql)) {
      const projectId = params[0] as string;
      const n = ENTITY_TABLES.filter((t) => t !== 'projects').reduce(
        (sum, t) =>
          sum +
          (db[t] as Row[]).filter(
            (r) => r.project_id === projectId && r.deleted_at === null
          ).length,
        0
      );
      return { n };
    }

    // Highest change id (realtime fan-out window).
    if (/SELECT MAX\(id\) AS max_id FROM sync_changes/.test(sql)) {
      const projectId = params[0] as string;
      const ids = db.sync_changes
        .filter((c) => c.project_id === projectId)
        .map((c) => c.id);
      return { max_id: ids.length ? Math.max(...ids) : null };
    }

    // Invitation lookup by code (acceptInvitation): JOIN projects supplies the
    // liveness flag; a missing project row (INNER JOIN) yields no result.
    if (/FROM invitations i\s+JOIN projects p ON p\.id = i\.project_id/.test(sql)) {
      const code = params[0] as string;
      const invite = db.invitations.find((i) => i.code === code);
      if (!invite) return null;
      const project = db.projects.find((p) => p.id === invite.project_id);
      if (!project) return null;
      return {
        id: invite.id,
        project_id: invite.project_id,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
        accepted_at: invite.accepted_at,
        project_deleted_at: project.deleted_at,
      };
    }

    // Live-row reads (existence + current-row merge + move project_id), all
    // project-scoped: WHERE id = ? AND project_id = ? [AND deleted_at IS NULL].
    // Single-binding reads (getProject) match on id alone.
    if (/deleted_at IS NULL/.test(sql)) {
      const table = tableInSql(sql);
      if (!table) return null;
      if (params.length === 1) {
        const [id] = params as [string];
        const row = (db[table] as Row[]).find(
          (r) => r.id === id && r.deleted_at === null
        );
        return row ?? null;
      }
      const [id, projectId] = params as [string, string];
      const row = (db[table] as Row[]).find(
        (r) =>
          r.id === id &&
          r.project_id === projectId &&
          r.deleted_at === null
      );
      return row ?? null;
    }

    return null;
  }

  function all(sql: string, params: unknown[]) {
    // getChangesSince: WHERE sc.project_id = ? AND (? IS NULL OR sc.id > ?)
    // (the template puts a newline between "sc" and "WHERE", hence \s+)
    if (/FROM sync_changes sc\s+WHERE/.test(sql)) {
      const [projectId, cursor] = params as [string, number | null];
      const results = db.sync_changes
        .filter(
          (c) =>
            c.project_id === projectId &&
            (cursor === null || cursor === undefined || c.id > cursor)
        )
        .sort((a, b) => a.id - b.id)
        .map((c) => ({
          id: c.id,
          change_id: c.change_id ?? `ch-${c.id}`,
          project_id: c.project_id,
          actor_id: c.actor_id ?? 'u1',
          entity_type: c.entity_type ?? 'task',
          entity_id: c.entity_id,
          operation: c.operation,
          patch_json: c.patch_json ?? '{}',
          base_version: c.base_version ?? null,
          client_mutation_id: c.client_mutation_id ?? null,
          client_id: c.client_id ?? null,
          created_at: c.created_at ?? NOW,
        }));
      return Promise.resolve({ results });
    }
    return Promise.resolve({ results: [] });
  }

  function prepare(sql: string) {
    return {
      bind(...params: unknown[]) {
        return {
          async first() {
            return first(sql, params);
          },
          async all() {
            return all(sql, params);
          },
          async run() {
            return run(sql, params);
          },
          // Marker used by batch() to replay the statement.
          __exec: () => run(sql, params),
        };
      },
    };
  }

  const database = {
    prepare,
    async batch(stmts: { __exec: () => unknown }[]) {
      // Model D1 batch atomicity: a throwing statement rolls the whole batch
      // back. Snapshot every table up front and restore on failure so tests
      // observe the same all-or-nothing semantics as production D1.
      const snapshot = {
        collections: structuredClone(db.collections),
        links: structuredClone(db.links),
        tasks: structuredClone(db.tasks),
        notes: structuredClone(db.notes),
        todos: structuredClone(db.todos),
        projects: structuredClone(db.projects),
        users: structuredClone(db.users),
        project_members: structuredClone(db.project_members),
        invitations: structuredClone(db.invitations),
        entity_versions: structuredClone(db.entity_versions),
        sync_changes: structuredClone(db.sync_changes),
      };
      try {
        return stmts.map((s) => s.__exec());
      } catch (error) {
        db.collections = snapshot.collections;
        db.links = snapshot.links;
        db.tasks = snapshot.tasks;
        db.notes = snapshot.notes;
        db.todos = snapshot.todos;
        db.projects = snapshot.projects;
        db.users = snapshot.users;
        db.project_members = snapshot.project_members;
        db.invitations = snapshot.invitations;
        db.entity_versions = snapshot.entity_versions;
        db.sync_changes = snapshot.sync_changes;
        throw error;
      }
    },
  };

  return { D1_DATABASE: database, ...vars } as unknown as Env;
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
    users: [],
    project_members: [{ project_id: 'p-dead', user_id: 'u1', role: 'owner' }],
    invitations: [],
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
