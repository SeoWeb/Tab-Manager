// Quota-commit-path fixtures — task 5.4, openspec/cleanup-and-regression-tests.
//
// READ-ONLY consumer of fixtures.ts: layers the three quota scenarios on top
// of the shared seeders with distinct, deterministic ids (each seeder seeds
// its own owner user row, so every scenario gets a DIFFERENT owner id — a
// shared id would trip the users PRIMARY KEY on the second seed).
//
// The suites size the caps through `makeTestEnv` var overrides; these seeds
// are built to those caps:
//
//   project cap — QUOTA_MAX_PROJECTS_PER_USER = 2; u-qp-owner pre-owns 1
//                 project (spare 1 → next create succeeds, the one after 403s)
//   member cap  — QUOTA_MAX_MEMBERS_PER_PROJECT = 3;
//                 p-mcap-full holds 3/3 members (breach scenario),
//                 p-mcap-part holds 2/3 (partial-capacity scenario)
//   entity cap  — QUOTA_MAX_ENTITIES_PER_PROJECT = 3;
//                 p-ecap-full holds 3/3 live entities (breach scenario),
//                 p-ecap-part holds 2/3 (partial-capacity scenario)

import {
  changelogFor,
  fetchRow,
  seedEntity,
  seedInvitation,
  seedMembership,
  seedOwnedProjects,
  seedProject,
  seedProjectAtEntityCap,
  seedProjectAtMemberCap,
  seedUser,
  seedVersion,
} from './fixtures';

// --- project-cap scenario ----------------------------------------------------

export const PROJECT_CAP_OWNER_ID = 'u-qp-owner';
export const PROJECT_CAP = 2;
/** Projects u-qp-owner already owns when the suite starts (spare 1 of 2). */
export const PROJECT_CAP_PRE_OWNED = 1;

// --- member-cap scenario -----------------------------------------------------

export const MEMBER_CAP = 3;
export const MEMBER_CAP_FULL_PROJECT = 'p-mcap-full';
export const MEMBER_CAP_FULL_OWNER_ID = 'u-qm-full';
export const MEMBER_CAP_FULL_INVITE_CODE = 'invite-mcap-full';
export const MEMBER_CAP_FULL_ACCEPTOR = {
  id: 'u-qm-acc-full',
  email: 'qm-acc-full@tabspace.test',
} as const;

export const MEMBER_CAP_PART_PROJECT = 'p-mcap-part';
export const MEMBER_CAP_PART_OWNER_ID = 'u-qm-part';
export const MEMBER_CAP_PART_FILLER_ID = 'u-qm-part-filler';
export const MEMBER_CAP_PART_INVITE_A_CODE = 'invite-mcap-part-a';
export const MEMBER_CAP_PART_INVITE_B_CODE = 'invite-mcap-part-b';
export const MEMBER_CAP_PART_ACCEPTOR_A = {
  id: 'u-qm-acc-a',
  email: 'qm-acc-a@tabspace.test',
} as const;
export const MEMBER_CAP_PART_ACCEPTOR_B = {
  id: 'u-qm-acc-b',
  email: 'qm-acc-b@tabspace.test',
} as const;

// --- entity-cap scenario -----------------------------------------------------

export const ENTITY_CAP = 3;
export const ENTITY_CAP_FULL_PROJECT = 'p-ecap-full';
export const ENTITY_CAP_FULL_OWNER_ID = 'u-qe-full';
/** q-ent-00000 is the first entity seedProjectAtEntityCap inserts — a
 * collection (round-robin starts at ENTITY_KINDS[0]). The update-at-cap
 * control mutates it, so it gets a version row to CAS against. */
export const ENTITY_CAP_FULL_UPDATE_TARGET = 'q-ent-00000';

export const ENTITY_CAP_PART_PROJECT = 'p-ecap-part';
export const ENTITY_CAP_PART_OWNER_ID = 'u-qe-part';

/** Fixed ids of the partial-capacity probe creates (fresh, non-seeded ids). */
export const ENTITY_CAP_PART_CREATE_A = 'qc-part-c1';
export const ENTITY_CAP_PART_CREATE_B = 'qc-part-l1';

/** Full-capacity breach probe create (fresh, non-seeded id). */
export const ENTITY_CAP_FULL_CREATE_ID = 'qc-full-c1';

/**
 * Seed all three quota scenarios. Call once from beforeAll. Seeds no
 * sync_changes rows anywhere — changelog baselines start EMPTY.
 */
export async function seedQuotaWorld(db: D1Database): Promise<void> {
  // Project cap: owner + 1 pre-owned project (env cap = 2).
  await seedUser(db, {
    id: PROJECT_CAP_OWNER_ID,
    email: 'qp-owner@tabspace.test',
    displayName: 'Project-Cap Owner',
  });
  await seedOwnedProjects(db, {
    ownerId: PROJECT_CAP_OWNER_ID,
    count: PROJECT_CAP_PRE_OWNED,
    prefix: 'p-qp-pre',
  });

  // Member cap: full (3/3) and partial (2/3) projects, their invitations and
  // the accepting users (users must exist — project_members FKs user_id).
  await seedProjectAtMemberCap(db, {
    cap: MEMBER_CAP,
    spare: 0,
    projectId: MEMBER_CAP_FULL_PROJECT,
    ownerId: MEMBER_CAP_FULL_OWNER_ID,
  });
  await seedInvitation(db, {
    projectId: MEMBER_CAP_FULL_PROJECT,
    code: MEMBER_CAP_FULL_INVITE_CODE,
    createdBy: MEMBER_CAP_FULL_OWNER_ID,
  });

  // Partial member-cap project: seedProjectAtMemberCap derives its filler
  // user ids from a fixed prefix, so calling it twice would collide on
  // users.email. The partial project is composed from primitives instead —
  // owner + one editor filler = 2 of 3 slots occupied.
  await seedUser(db, {
    id: MEMBER_CAP_PART_OWNER_ID,
    email: 'qm-part-owner@tabspace.test',
    displayName: 'Member-Cap Partial Owner',
  });
  await seedUser(db, {
    id: MEMBER_CAP_PART_FILLER_ID,
    email: 'qm-part-filler@tabspace.test',
    displayName: 'Member-Cap Partial Filler',
  });
  await seedProject(db, {
    id: MEMBER_CAP_PART_PROJECT,
    ownerId: MEMBER_CAP_PART_OWNER_ID,
  });
  await seedMembership(db, {
    projectId: MEMBER_CAP_PART_PROJECT,
    userId: MEMBER_CAP_PART_OWNER_ID,
    role: 'owner',
  });
  await seedMembership(db, {
    projectId: MEMBER_CAP_PART_PROJECT,
    userId: MEMBER_CAP_PART_FILLER_ID,
    role: 'editor',
  });
  await seedInvitation(db, {
    projectId: MEMBER_CAP_PART_PROJECT,
    code: MEMBER_CAP_PART_INVITE_A_CODE,
    createdBy: MEMBER_CAP_PART_OWNER_ID,
  });
  await seedInvitation(db, {
    projectId: MEMBER_CAP_PART_PROJECT,
    code: MEMBER_CAP_PART_INVITE_B_CODE,
    createdBy: MEMBER_CAP_PART_OWNER_ID,
  });

  for (const user of [
    MEMBER_CAP_FULL_ACCEPTOR,
    MEMBER_CAP_PART_ACCEPTOR_A,
    MEMBER_CAP_PART_ACCEPTOR_B,
  ]) {
    await seedUser(db, {
      id: user.id,
      email: user.email,
      displayName: `Acceptor ${user.id}`,
    });
  }

  // Entity cap: full (3/3) and partial (2/3) projects. seedProjectAtEntityCap
  // does NOT seed its owner user row (projects.owner_id is FK-enforced), so
  // both owners are seeded here first. The full project's first entity also
  // gets a version row so the update-at-cap control has a CAS basis (entities
  // without version rows cannot be CAS-mutated).
  await seedUser(db, {
    id: ENTITY_CAP_FULL_OWNER_ID,
    email: 'qe-full@tabspace.test',
    displayName: 'Entity-Cap Full Owner',
  });
  await seedUser(db, {
    id: ENTITY_CAP_PART_OWNER_ID,
    email: 'qe-part@tabspace.test',
    displayName: 'Entity-Cap Partial Owner',
  });
  await seedProjectAtEntityCap(db, {
    cap: ENTITY_CAP,
    spare: 0,
    projectId: ENTITY_CAP_FULL_PROJECT,
    ownerId: ENTITY_CAP_FULL_OWNER_ID,
  });
  await seedVersion(db, {
    projectId: ENTITY_CAP_FULL_PROJECT,
    entityType: 'collection',
    entityId: ENTITY_CAP_FULL_UPDATE_TARGET,
    version: 1,
  });

  // Partial entity-cap project: seedProjectAtEntityCap derives its bulk
  // entity ids from a fixed prefix, so calling it twice would collide on the
  // entity PRIMARY KEYs. The partial project (2 of 3 slots occupied) is
  // composed from primitives instead.
  await seedProject(db, {
    id: ENTITY_CAP_PART_PROJECT,
    ownerId: ENTITY_CAP_PART_OWNER_ID,
  });
  await seedMembership(db, {
    projectId: ENTITY_CAP_PART_PROJECT,
    userId: ENTITY_CAP_PART_OWNER_ID,
    role: 'owner',
  });
  await seedEntity(db, 'collection', {
    id: 'qc-part-seed-c',
    projectId: ENTITY_CAP_PART_PROJECT,
  });
  await seedEntity(db, 'link', {
    id: 'qc-part-seed-l',
    projectId: ENTITY_CAP_PART_PROJECT,
  });
}

// ---------------------------------------------------------------------------
// Inspection helpers
// ---------------------------------------------------------------------------

/** Membership role of one user in one project, or undefined. */
export async function memberRole(
  db: D1Database,
  projectId: string,
  userId: string
): Promise<string | undefined> {
  const row = await db
    .prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first<{ role: string }>();
  return row?.role;
}

export async function countOwnedProjects(
  db: D1Database,
  ownerId: string
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM projects WHERE owner_id = ? AND deleted_at IS NULL'
    )
    .bind(ownerId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countProjectMembers(
  db: D1Database,
  projectId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?')
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Memberships of one user across ALL projects — catches orphaned phase-2
 * membership rows a breached project-create must never leave behind. */
export async function countUserMemberships(
  db: D1Database,
  userId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countProjectInvitations(
  db: D1Database,
  projectId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM invitations WHERE project_id = ?')
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countAllSyncChanges(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM sync_changes')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function invitationRow(db: D1Database, code: string) {
  const row = await fetchRow(db, 'invitations', `inv-${code}`);
  return row;
}

export { changelogFor, fetchRow };
