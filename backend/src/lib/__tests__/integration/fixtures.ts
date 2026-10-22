// Shared integration fixtures — task 5.2, openspec/cleanup-and-regression-tests.
//
// READ-ONLY CONTRACT for later suites (treat changes here as breaking):
//   5.3 IDOR matrix      — seedCanonicalWorld + CANONICAL_ENTITY_IDS +
//                          DEAD_TASK_ID + MAIN_PROJECT_ID / FOREIGN_PROJECT_ID
//   5.4 quota commit paths — seedProjectAtEntityCap / seedProjectAtMemberCap /
//                          seedOwnedProjects + countLiveEntities + changelogFor
//   5.5 concurrency      — seedInvitation (accept races), seedLoginCode
//                          (verify/brute-force races), seedVersion (CAS bases)
//
// Design rules:
//  * Deterministic — every id/email/code is a fixed literal; timestamps are the
//    fixed NOW/DELETED_AT constants. No randomness except the login-code salt
//    (mandated by the at-rest hashing scheme; verification behavior is still
//    deterministic: the seeded row verifies `code` and nothing else).
//  * Raw SQL — fixtures INSERT directly through the D1 binding, bypassing the
//    application layer, so suites test app behavior against known state.
//  * Node-import-safe — no `cloudflare:*` imports at module scope; every
//    function takes the `D1Database` explicitly. Callers get it from
//    harness.ts `getTestEnv()`.

import { encodeLoginCode, MAX_CODE_ATTEMPTS } from '../../login';
import type { EntityType, Role } from '../../../types';

// ---------------------------------------------------------------------------
// Fixed time
// ---------------------------------------------------------------------------

/** Fixed "now" for every seeded row (ISO-8601 UTC, lexicographic order). */
export const NOW = '2020-01-01T00:00:00.000Z';
/** Fixed soft-delete timestamp. */
export const DELETED_AT = '2021-01-01T00:00:00.000Z';
/** Fixed login-code expiry — far enough past NOW to be live, future enough
 * for `expires_at > created_at` style asserts. Semantically "live". */
export const CODE_EXPIRES_AT = '2030-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Entity types ↔ tables
// ---------------------------------------------------------------------------

/** The five synced entity kinds and their D1 tables. */
export const ENTITY_TABLES = {
  collection: 'collections',
  link: 'links',
  task: 'tasks',
  note: 'notes',
  todo: 'todos',
} as const;

export type EntityKind = keyof typeof ENTITY_TABLES;
export type EntityTable = (typeof ENTITY_TABLES)[EntityKind];

export const ENTITY_KINDS = Object.keys(ENTITY_TABLES) as EntityKind[];

// ---------------------------------------------------------------------------
// Fixed identities (users at roles) + projects
// ---------------------------------------------------------------------------

export interface FixtureUser {
  id: string;
  email: string;
  displayName: string;
  /** Membership role in MAIN_PROJECT_ID, or null when not a member. */
  role: Role | null;
}

/** The canonical cast. Roles in the seeded main project:
 *  owner → 'owner', member → 'editor' (a write-capable member), viewer →
 *  'viewer', exMember → membership row REMOVED (was a member once),
 *  outsider → never a member of main; owns FOREIGN_PROJECT_ID. */
export const FIXTURE_USERS: Record<
  'owner' | 'member' | 'exMember' | 'viewer' | 'outsider',
  FixtureUser
> = {
  owner: {
    id: 'u-owner',
    email: 'owner@tabspace.test',
    displayName: 'Owner',
    role: 'owner',
  },
  member: {
    id: 'u-member',
    email: 'member@tabspace.test',
    displayName: 'Member',
    role: 'editor',
  },
  exMember: {
    id: 'u-ex-member',
    email: 'ex-member@tabspace.test',
    displayName: 'Ex-Member',
    role: null,
  },
  viewer: {
    id: 'u-viewer',
    email: 'viewer@tabspace.test',
    displayName: 'Viewer',
    role: 'viewer',
  },
  outsider: {
    id: 'u-outsider',
    email: 'outsider@tabspace.test',
    displayName: 'Outsider',
    role: null,
  },
};

/** The project every canonical world entity lives in (owner-owned). */
export const MAIN_PROJECT_ID = 'p-main';
/** Outsider-owned project — the target for cross-project move/IDOR probes. */
export const FOREIGN_PROJECT_ID = 'p-foreign';

/** Live entity of each kind in the main project. */
export const CANONICAL_ENTITY_IDS: Record<EntityKind, string> = {
  collection: 'c-live',
  link: 'l-live',
  task: 't-live',
  note: 'n-live',
  todo: 'd-live',
};

/** A soft-deleted task in the main project (for deleted-entity matrix cells). */
export const DEAD_TASK_ID = 't-dead';

// ---------------------------------------------------------------------------
// Raw seeders
// ---------------------------------------------------------------------------

/** Insert a user row. */
export async function seedUser(
  db: D1Database,
  user: { id: string; email: string; displayName?: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(user.id, user.email, user.displayName ?? null, NOW, NOW)
    .run();
}

/** Insert a project row (live unless `deletedAt` given). */
export async function seedProject(
  db: D1Database,
  opts: {
    id: string;
    ownerId: string;
    name?: string;
    deletedAt?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO projects (id, name, description, color, icon, owner_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`
    )
    .bind(
      opts.id,
      opts.name ?? `Project ${opts.id}`,
      opts.ownerId,
      NOW,
      NOW,
      opts.deletedAt ?? null
    )
    .run();
}

/** Insert a membership row. */
export async function seedMembership(
  db: D1Database,
  opts: { projectId: string; userId: string; role: Role }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `pm-${opts.projectId}-${opts.userId}`,
      opts.projectId,
      opts.userId,
      opts.role,
      NOW,
      NOW
    )
    .run();
}

/** Delete a membership row — models the "removed from project" (ex-member)
 * state without touching the user row. */
export async function removeMembership(
  db: D1Database,
  opts: { projectId: string; userId: string }
): Promise<void> {
  await db
    .prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(opts.projectId, opts.userId)
    .run();
}

export interface SeedEntityOptions {
  id?: string;
  projectId?: string;
  /** Parent collection (link/task/note/todo only; ignored for collections). */
  collectionId?: string | null;
  title?: string;
  /** Soft-delete the entity at DELETED_AT. */
  deleted?: boolean;
  orderIndex?: number;
  /** payload_json for task/note/todo. */
  payloadJson?: string;
  /** URL for links. */
  url?: string;
}

interface EntityInsert {
  sql: string;
  bindings: unknown[];
}

/** Build the INSERT (sql + bindings) for one entity row of `kind`. Shared by
 * `seedEntity` (executes immediately) and the bulk quota seeder. */
function entityInsert(
  kind: EntityKind,
  opts: {
    id: string;
    projectId: string;
    collectionId: string | null;
    title?: string;
    deletedAt: string | null;
    orderIndex: number;
    payloadJson?: string;
    url?: string;
  }
): EntityInsert {
  const { id, projectId, deletedAt } = opts;
  const table = ENTITY_TABLES[kind];
  if (kind === 'collection') {
    return {
      sql: `INSERT INTO ${table}
        (id, project_id, name, description, color, minimized, order_index, bookmark_folder_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, NULL, NULL, 0, ?, NULL, ?, ?, ?)`,
      bindings: [
        id,
        projectId,
        opts.title ?? `Collection ${id}`,
        opts.orderIndex,
        NOW,
        NOW,
        deletedAt,
      ],
    };
  }
  if (kind === 'link') {
    return {
      sql: `INSERT INTO ${table}
        (id, project_id, collection_id, url, title, fav_icon_url, notes, tags_json, order_index, bookmark_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?)`,
      bindings: [
        id,
        projectId,
        opts.collectionId,
        opts.url ?? `https://example.com/${id}`,
        opts.title ?? `Link ${id}`,
        opts.orderIndex,
        NOW,
        NOW,
        deletedAt,
      ],
    };
  }
  // task / note / todo share the same column shape.
  return {
    sql: `INSERT INTO ${table}
      (id, project_id, collection_id, title, payload_json, order_index, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bindings: [
      id,
      projectId,
      opts.collectionId,
      opts.title ?? `${kind} ${id}`,
      opts.payloadJson ?? '{}',
      opts.orderIndex,
      NOW,
      NOW,
      deletedAt,
    ],
  };
}

/** Insert one entity row of `kind`. Returns the row id. */
export async function seedEntity(
  db: D1Database,
  kind: EntityKind,
  opts: SeedEntityOptions = {}
): Promise<string> {
  const id = opts.id ?? CANONICAL_ENTITY_IDS[kind];
  const { sql, bindings } = entityInsert(kind, {
    id,
    projectId: opts.projectId ?? MAIN_PROJECT_ID,
    collectionId:
      kind === 'collection' ? null : (opts.collectionId ?? null),
    title: opts.title,
    deletedAt: opts.deleted ? DELETED_AT : null,
    orderIndex: opts.orderIndex ?? 0,
    payloadJson: opts.payloadJson,
    url: opts.url,
  });
  await db.prepare(sql).bind(...bindings).run();
  return id;
}

/** Insert an entity_versions row at an explicit version — the CAS base for
 * version-conflict tests. `entityType` is the app-level singular type
 * (EntityKind or 'project'). */
export async function seedVersion(
  db: D1Database,
  opts: {
    projectId: string;
    entityType: EntityType;
    entityId: string;
    version: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entity_versions (project_id, entity_type, entity_id, version, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(opts.projectId, opts.entityType, opts.entityId, opts.version, NOW)
    .run();
}

export interface SeedInvitationOptions {
  id?: string;
  projectId: string;
  code: string;
  createdBy: string;
  role?: Role;
  email?: string | null;
  /** Expired invitation when set to a past timestamp. */
  expiresAt?: string;
  acceptedAt?: string | null;
}

/** Insert an invitation row. Returns the fixed id/code. */
export async function seedInvitation(
  db: D1Database,
  opts: SeedInvitationOptions
): Promise<{ id: string; code: string }> {
  const id = opts.id ?? `inv-${opts.code}`;
  await db
    .prepare(
      `INSERT INTO invitations (id, project_id, code, email, role, created_by, expires_at, accepted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      opts.projectId,
      opts.code,
      opts.email ?? null,
      opts.role ?? 'editor',
      opts.createdBy,
      opts.expiresAt ?? CODE_EXPIRES_AT,
      opts.acceptedAt ?? null,
      NOW
    )
    .run();
  return { id, code: opts.code };
}

export interface SeedLoginCodeOptions {
  email: string;
  /** The plaintext code the seeded row will verify. */
  code: string;
  displayName?: string;
  expiresAt?: string;
  attempts?: number;
  requestCount?: number;
  firstRequestAt?: string;
}

/** Insert a login_codes row whose verifier matches `code` (hashed with the
 * production scheme: fresh random salt + SHA-256, see src/lib/login.ts).
 * `attempts` defaults to 0 (MAX_CODE_ATTEMPTS is the cap the app enforces). */
export async function seedLoginCode(
  db: D1Database,
  opts: SeedLoginCodeOptions
): Promise<void> {
  const verifier = await encodeLoginCode(opts.code);
  await db
    .prepare(
      `INSERT INTO login_codes (email, code, display_name, expires_at, created_at, attempts, request_count, first_request_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      opts.email,
      verifier,
      opts.displayName ?? null,
      opts.expiresAt ?? CODE_EXPIRES_AT,
      NOW,
      opts.attempts ?? 0,
      opts.requestCount ?? 1,
      opts.firstRequestAt ?? NOW
    )
    .run();
}

// ---------------------------------------------------------------------------
// Composite scenario: the canonical world
// ---------------------------------------------------------------------------

export interface CanonicalWorld {
  projectId: string;
  foreignProjectId: string;
  users: typeof FIXTURE_USERS;
  /** Live entity id per kind in the main project, each at version 1. */
  entities: Record<EntityKind, { id: string; table: EntityTable; version: number }>;
  deadTaskId: string;
  /** Pending (unaccepted, unexpired) invitation into the main project. */
  pendingInvitation: { id: string; code: string };
}

/**
 * Seed the full canonical world used by the IDOR matrix and most suites:
 *
 *  - all five users (owner, member=editor, ex-member with membership removed,
 *    viewer, outsider);
 *  - MAIN_PROJECT_ID owned by owner with member(editor) + viewer memberships;
 *  - FOREIGN_PROJECT_ID owned by outsider, no other members, no entities;
 *  - one LIVE entity of each of the five kinds in main (canonical ids), each
 *    with an entity_versions row at version 1 (CAS base);
 *  - one soft-deleted task (DEAD_TASK_ID, version 3);
 *  - one pending invitation (code 'invite-canonical') into main.
 */
export async function seedCanonicalWorld(db: D1Database): Promise<CanonicalWorld> {
  for (const user of Object.values(FIXTURE_USERS)) {
    await seedUser(db, user);
  }

  await seedProject(db, {
    id: MAIN_PROJECT_ID,
    ownerId: FIXTURE_USERS.owner.id,
    name: 'Main Project',
  });
  await seedProject(db, {
    id: FOREIGN_PROJECT_ID,
    ownerId: FIXTURE_USERS.outsider.id,
    name: 'Foreign Project',
  });

  await seedMembership(db, {
    projectId: MAIN_PROJECT_ID,
    userId: FIXTURE_USERS.owner.id,
    role: 'owner',
  });
  await seedMembership(db, {
    projectId: MAIN_PROJECT_ID,
    userId: FIXTURE_USERS.member.id,
    role: FIXTURE_USERS.member.role as Role,
  });
  await seedMembership(db, {
    projectId: MAIN_PROJECT_ID,
    userId: FIXTURE_USERS.viewer.id,
    role: FIXTURE_USERS.viewer.role as Role,
  });
  // ex-member: user exists, membership was removed — nothing to seed.

  const entities = {} as CanonicalWorld['entities'];
  for (const kind of ENTITY_KINDS) {
    const id = await seedEntity(db, kind, {
      collectionId: kind === 'collection' ? undefined : CANONICAL_ENTITY_IDS.collection,
    });
    await seedVersion(db, {
      projectId: MAIN_PROJECT_ID,
      entityType: kind,
      entityId: id,
      version: 1,
    });
    entities[kind] = { id, table: ENTITY_TABLES[kind], version: 1 };
  }

  await seedEntity(db, 'task', { id: DEAD_TASK_ID, deleted: true });
  await seedVersion(db, {
    projectId: MAIN_PROJECT_ID,
    entityType: 'task',
    entityId: DEAD_TASK_ID,
    version: 3,
  });

  const pendingInvitation = await seedInvitation(db, {
    projectId: MAIN_PROJECT_ID,
    code: 'invite-canonical',
    createdBy: FIXTURE_USERS.owner.id,
  });

  return {
    projectId: MAIN_PROJECT_ID,
    foreignProjectId: FOREIGN_PROJECT_ID,
    users: FIXTURE_USERS,
    entities,
    deadTaskId: DEAD_TASK_ID,
    pendingInvitation,
  };
}

// ---------------------------------------------------------------------------
// Composite scenario: quota-consumed projects (task 5.4)
// ---------------------------------------------------------------------------

/** App defaults from src/lib/quotas.ts getQuotaConfig — mirrored so quota
 * fixtures can size themselves without importing app code that reads env. */
export const DEFAULT_QUOTA = {
  maxProjectsPerUser: 10,
  maxMembersPerProject: 50,
  maxEntitiesPerProject: 5000,
} as const;

/**
 * Seed a project holding `cap - spare` LIVE entities spread across the five
 * entity tables (round-robin), i.e. exactly `spare` slots short of the cap.
 *
 * With the app's default entity cap (5000) prefer passing a small `cap` (the
 * suite overrides QUOTA_MAX_ENTITIES_PER_PROJECT via makeTestEnv) — bulk
 * inserts are chunked D1 batches, fast for hundreds, not for tens of thousands.
 * Returns the number of entities inserted.
 */
export async function seedProjectAtEntityCap(
  db: D1Database,
  opts: {
    /** Entity cap the app will enforce. */
    cap: number;
    /** Free slots to leave (default 0 = fully consumed). */
    spare?: number;
    projectId?: string;
    ownerId?: string;
  }
): Promise<number> {
  const projectId = opts.projectId ?? 'p-quota';
  const ownerId = opts.ownerId ?? FIXTURE_USERS.owner.id;
  const spare = opts.spare ?? 0;
  const count = Math.max(0, opts.cap - spare);

  await seedProject(db, { id: projectId, ownerId });
  await seedMembership(db, { projectId, userId: ownerId, role: 'owner' });

  const CHUNK = 50;
  for (let start = 0; start < count; start += CHUNK) {
    const statements: D1PreparedStatement[] = [];
    for (let i = start; i < Math.min(start + CHUNK, count); i++) {
      const kind = ENTITY_KINDS[i % ENTITY_KINDS.length];
      const id = `q-ent-${String(i).padStart(5, '0')}`;
      statements.push(
        entityInsertStatement(db, kind, {
          id,
          projectId,
          collectionId: null,
          title: `Quota ${i}`,
          deletedAt: null,
          orderIndex: i,
          payloadJson: '{}',
          url: `https://example.com/${id}`,
        })
      );
    }
    await db.batch(statements);
  }
  return count;
}

/**
 * Seed a project holding `cap - spare` members (owner included), i.e. exactly
 * `spare` slots short of the member cap. Filler members get deterministic
 * user rows (`u-quota-m-0000`…). Returns the member count inserted (including
 * the owner).
 */
export async function seedProjectAtMemberCap(
  db: D1Database,
  opts: {
    cap: number;
    spare?: number;
    projectId?: string;
    ownerId?: string;
  }
): Promise<number> {
  const projectId = opts.projectId ?? 'p-quota-members';
  const ownerId = opts.ownerId ?? FIXTURE_USERS.owner.id;
  const spare = opts.spare ?? 0;
  const count = Math.max(1, opts.cap - spare); // at least the owner

  await seedUser(db, {
    id: ownerId,
    email: `${ownerId}@tabspace.test`,
    displayName: 'Quota Owner',
  });
  await seedProject(db, { id: projectId, ownerId });
  await seedMembership(db, { projectId, userId: ownerId, role: 'owner' });

  for (let i = 0; i < count - 1; i++) {
    const userId = `u-quota-m-${String(i).padStart(4, '0')}`;
    await seedUser(db, {
      id: userId,
      email: `${userId}@tabspace.test`,
      displayName: `Quota Member ${i}`,
    });
    await seedMembership(db, { projectId, userId, role: 'editor' });
  }
  return count;
}

/**
 * Seed `count` live projects owned by one user — the project-cap fixture.
 * Returns the ids (`p-quota-proj-0000`…), not counting any other projects the
 * user may already own.
 */
export async function seedOwnedProjects(
  db: D1Database,
  opts: { ownerId: string; count: number; prefix?: string }
): Promise<string[]> {
  const prefix = opts.prefix ?? 'p-quota-proj';
  const ids: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const id = `${prefix}-${String(i).padStart(4, '0')}`;
    await seedProject(db, { id, ownerId: opts.ownerId });
    ids.push(id);
  }
  return ids;
}

/** Build the INSERT statement for one entity row without executing it
 * (bulk-seeding helper for the quota fixture). */
function entityInsertStatement(
  db: D1Database,
  kind: EntityKind,
  opts: {
    id: string;
    projectId: string;
    collectionId: string | null;
    title: string;
    deletedAt: string | null;
    orderIndex: number;
    payloadJson: string;
    url: string;
  }
): D1PreparedStatement {
  const { sql, bindings } = entityInsert(kind, opts);
  return db.prepare(sql).bind(...bindings);
}

// ---------------------------------------------------------------------------
// Inspection helpers (assertion support)
// ---------------------------------------------------------------------------

/** First row by id from a table, or undefined. */
export async function fetchRow(
  db: D1Database,
  table:
    | EntityTable
    | 'projects'
    | 'users'
    | 'project_members'
    | 'invitations'
    | 'login_codes'
    | 'project_sync_meta'
    | 'entity_versions'
    | 'sync_changes',
  id: string
): Promise<Record<string, unknown> | undefined> {
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return result ?? undefined;
}

/** Membership rows of a project, as (userId, role) pairs. */
export async function getMembers(
  db: D1Database,
  projectId: string
): Promise<{ userId: string; role: Role }[]> {
  const { results } = await db
    .prepare(
      'SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id'
    )
    .bind(projectId)
    .all<{ user_id: string; role: Role }>();
  return results.map((r) => ({ userId: r.user_id, role: r.role }));
}

/** Live (non-soft-deleted) entity count across the five entity tables for a
 * project — the same quantity the app's entity-quota guard counts. */
export async function countLiveEntities(
  db: D1Database,
  projectId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM collections WHERE project_id = ?1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM links WHERE project_id = ?1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM notes WHERE project_id = ?1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM todos WHERE project_id = ?1 AND deleted_at IS NULL)
      AS n`
    )
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Current entity version, or undefined when the entity has none. */
export async function versionOf(
  db: D1Database,
  projectId: string,
  entityType: EntityType,
  entityId: string
): Promise<number | undefined> {
  const row = await db
    .prepare(
      'SELECT version FROM entity_versions WHERE project_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(projectId, entityType, entityId)
    .first<{ version: number }>();
  return row?.version;
}

export interface ChangelogRow {
  id: number;
  entity_type: string;
  entity_id: string;
  operation: string;
  client_mutation_id: string | null;
  actor_id: string;
}

/** The project's sync_changes rows in id order — "no phantom changelog row"
 * assertions read this. */
export async function changelogFor(
  db: D1Database,
  projectId: string
): Promise<ChangelogRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, entity_type, entity_id, operation, client_mutation_id, actor_id
       FROM sync_changes WHERE project_id = ? ORDER BY id`
    )
    .bind(projectId)
    .all<ChangelogRow>();
  return results;
}

/** Current attempts counter of a login_codes row (brute-force cap checks). */
export async function loginCodeAttempts(
  db: D1Database,
  email: string
): Promise<number | undefined> {
  const row = await db
    .prepare('SELECT attempts FROM login_codes WHERE email = ?')
    .bind(email)
    .first<{ attempts: number }>();
  return row?.attempts;
}

/** Re-export for suites that need the app's brute-force cap in asserts. */
export { MAX_CODE_ATTEMPTS };
