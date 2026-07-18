import { badRequest, forbidden, notFound } from './response';
import { checkMemberQuota, checkProjectQuota, getQuotaConfig } from './quotas';
import { getLatestChange } from './sync';
import { notifyRealtime } from './realtime';
import type {
  Env,
  Project,
  ProjectMember,
  Role,
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
  SyncOperation,
} from '../types';

const roleRank: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

const validRoles = new Set<string>(Object.keys(roleRank));

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRole(value: unknown): Role | null {
  return typeof value === 'string' && validRoles.has(value)
    ? (value as Role)
    : null;
}

export function requireMinRole(actual: Role | null, minimum: Role): boolean {
  if (!actual) return false;
  return roleRank[actual] >= roleRank[minimum];
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export async function getMembershipRole(
  env: Env,
  userId: string,
  projectId: string
): Promise<Role | null> {
  const row = await env.D1_DATABASE.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  )
    .bind(projectId, userId)
    .first<{ role: Role }>();

  return row?.role ?? null;
}

async function countOwners(env: Env, projectId: string): Promise<number> {
  const row = await env.D1_DATABASE.prepare(
    "SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'"
  )
    .bind(projectId)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

export async function countMembers(
  env: Env,
  projectId: string
): Promise<number> {
  const row = await env.D1_DATABASE.prepare(
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?'
  )
    .bind(projectId)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

export async function getProjectMember(
  env: Env,
  userId: string,
  projectId: string
): Promise<ProjectMember | null> {
  return env.D1_DATABASE.prepare(
    `
    SELECT
      pm.id,
      pm.project_id,
      pm.user_id,
      pm.role,
      pm.created_at,
      pm.updated_at,
      u.email,
      u.display_name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ? AND pm.user_id = ?
    `
  )
    .bind(projectId, userId)
    .first<ProjectMember>();
}

export async function requireProjectAccess(
  env: Env,
  userId: string,
  projectId: string,
  minimumRole: Role = 'viewer'
): Promise<ProjectMember | Response> {
  const member = await getProjectMember(env, userId, projectId);
  if (!member) {
    return forbidden('You do not have access to this project');
  }

  if (!requireMinRole(member.role, minimumRole)) {
    return forbidden(`Project access requires ${minimumRole} role or higher`);
  }

  return member;
}

export async function listProjects(
  env: Env,
  userId: string
): Promise<(Project & { role: Role })[]> {
  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT
      p.id,
      p.name,
      p.description,
      p.color,
      p.icon,
      p.owner_id,
      p.created_at,
      p.updated_at,
      p.deleted_at,
      pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ? AND p.deleted_at IS NULL
    ORDER BY p.updated_at DESC
    `
  )
    .bind(userId)
    .all<Project & { role: Role }>();

  return rows.results ?? [];
}

export async function getProject(
  env: Env,
  projectId: string
): Promise<Project | null> {
  return env.D1_DATABASE.prepare(
    'SELECT id, name, description, color, icon, owner_id, created_at, updated_at, deleted_at FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first<Project>();
}

export async function createProject(
  env: Env,
  owner: { id: string },
  body: unknown
): Promise<Response> {
  const input = body as {
    name?: unknown;
    description?: unknown;
    color?: unknown;
    icon?: unknown;
  };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return badRequest('Project name is required');
  }

  const now = nowIso();
  const id = crypto.randomUUID();
  const description = parseOptionalString(input.description);
  const color = parseOptionalString(input.color);
  const icon = parseOptionalString(input.icon);
  const patch = { id, name, description, color, icon, owner_id: owner.id };

  // The project row is the quota-consuming write. It is inserted via an
  // `INSERT ... SELECT ... WHERE (count) < limit` guard so the count check and
  // the insert run inside a single D1 batch (one transaction). Concurrent
  // creates therefore cannot both observe capacity and overshoot the cap — at
  // most one wins the final slot. The owner membership, version seed, and
  // change log only run once the project insert succeeds.
  const maxProjects = getQuotaConfig(env).maxProjectsPerUser;
  const primary = env.D1_DATABASE.prepare(
    `
    INSERT INTO projects (id, name, description, color, icon, owner_id, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM projects WHERE owner_id = ? AND deleted_at IS NULL
    ) < ?
    `
  ).bind(
    id,
    name,
    description,
    color,
    icon,
    owner.id,
    now,
    now,
    owner.id,
    maxProjects
  );

  const quota = await checkProjectQuota(env, owner.id, {
    primary,
    dependents: [
      env.D1_DATABASE.prepare(
        `
        INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).bind(id, id, owner.id, 'owner', now, now),
      prepareIncrementVersion(env, id, 'project', id, now),
      prepareInsertSyncChange(env, {
        projectId: id,
        actorId: owner.id,
        entityType: 'project',
        entityId: id,
        operation: 'create',
        patch,
        clientMutationId: null,
        clientId: null,
        createdAt: now,
      }),
    ],
  });
  if (quota) return quota;

  const project = await getProject(env, id);
  return Response.json(project, { status: 201 });
}

export async function updateProject(
  env: Env,
  user: { id: string },
  projectId: string,
  body: unknown
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'admin');
  if (access instanceof Response) return access;

  const input = body as {
    name?: unknown;
    description?: unknown;
    color?: unknown;
    icon?: unknown;
  };

  const existing = await env.D1_DATABASE.prepare(
    'SELECT id, name, description, color, icon FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first<Project>();

  if (!existing) {
    return notFound('Project not found');
  }

  const name =
    input.name === undefined ? existing.name : parseOptionalString(input.name);
  if (!name) {
    return badRequest('Project name cannot be empty');
  }

  const description =
    input.description === undefined
      ? existing.description
      : parseOptionalString(input.description);
  const color =
    input.color === undefined
      ? existing.color
      : parseOptionalString(input.color);
  const icon =
    input.icon === undefined ? existing.icon : parseOptionalString(input.icon);
  const now = nowIso();

  await env.D1_DATABASE.batch([
    env.D1_DATABASE.prepare(
      `
      UPDATE projects
      SET name = ?, description = ?, color = ?, icon = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
      `
    ).bind(name, description, color, icon, now, projectId),
    prepareIncrementVersion(env, projectId, 'project', projectId, now),
    prepareInsertSyncChange(env, {
      projectId,
      actorId: user.id,
      entityType: 'project',
      entityId: projectId,
      operation: 'update',
      patch: { name, description, color, icon },
      clientMutationId: null,
      clientId: null,
      createdAt: now,
    }),
  ]);

  // Fan the project-meta change out to anyone viewing the project live.
  const latestUpdate = await getLatestChange(env, projectId);
  if (latestUpdate) await notifyRealtime(env, projectId, [latestUpdate]);

  const project = await getProject(env, projectId);
  return Response.json(project);
}

export async function deleteProject(
  env: Env,
  user: { id: string },
  projectId: string
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'admin');
  if (access instanceof Response) return access;

  const existing = await env.D1_DATABASE.prepare(
    'SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first<{ id: string }>();

  if (!existing) {
    return notFound('Project not found');
  }

  const memberCount = await countMembers(env, projectId);
  if (memberCount > 1) {
    return badRequest('Cannot delete project with multiple members');
  }

  const now = nowIso();
  await env.D1_DATABASE.batch([
    env.D1_DATABASE.prepare(
      'UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, now, projectId),
    prepareIncrementVersion(env, projectId, 'project', projectId, now),
    prepareInsertSyncChange(env, {
      projectId,
      actorId: user.id,
      entityType: 'project',
      entityId: projectId,
      operation: 'delete',
      patch: { deleted_at: now },
      clientMutationId: null,
      clientId: null,
      createdAt: now,
    }),
  ]);

  // Tell anyone viewing the project that it was deleted so they can drop it.
  const latestDelete = await getLatestChange(env, projectId);
  if (latestDelete) await notifyRealtime(env, projectId, [latestDelete]);

  return Response.json({ deleted: true, id: projectId });
}

export async function getProjectMembers(
  env: Env,
  user: { id: string },
  projectId: string
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'viewer');
  if (access instanceof Response) return access;

  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT
      pm.id,
      pm.project_id,
      pm.user_id,
      pm.role,
      pm.created_at,
      pm.updated_at,
      u.email,
      u.display_name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.email ASC
    `
  )
    .bind(projectId)
    .all<ProjectMember>();

  const members = (rows.results ?? []).map((m) => ({
    id: m.id,
    project_id: m.project_id,
    user_id: m.user_id,
    role: m.role,
    created_at: m.created_at,
    updated_at: m.updated_at,
    email: m.email,
    display_name: m.display_name,
  }));

  return Response.json({ members });
}

export async function createInvitation(
  env: Env,
  user: { id: string },
  projectId: string,
  body: unknown
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'admin');
  if (access instanceof Response) return access;

  const input = body as {
    email?: unknown;
    role?: unknown;
    expiresInDays?: unknown;
  };

  const email = parseOptionalString(input.email);
  const role = normalizeRole(input.role) ?? 'editor';
  if (role === 'owner') {
    return badRequest('Invitations cannot grant the owner role');
  }
  const expiresInDays =
    typeof input.expiresInDays === 'number' &&
    Number.isFinite(input.expiresInDays)
      ? input.expiresInDays
      : 7;
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = nowIso();
  const id = crypto.randomUUID();
  const code = crypto.randomUUID();

  // The invitation is the quota-consuming write. It is inserted via an
  // `INSERT ... SELECT ... WHERE (member count) < limit` guard so the count
  // check and the insert run in a single D1 batch. Concurrent invites therefore
  // cannot both observe capacity and overshoot the member cap.
  const maxMembers = getQuotaConfig(env).maxMembersPerProject;
  const primary = env.D1_DATABASE.prepare(
    `
    INSERT INTO invitations (id, project_id, code, email, role, created_by, expires_at, accepted_at, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?
    WHERE (
      SELECT COUNT(*) FROM project_members WHERE project_id = ?
    ) < ?
    `
  ).bind(
    id,
    projectId,
    code,
    email,
    role,
    user.id,
    expiresAt,
    now,
    projectId,
    maxMembers
  );

  const memberQuota = await checkMemberQuota(env, projectId, { primary });
  if (memberQuota) return memberQuota;

  return Response.json(
    {
      id,
      code,
      project_id: projectId,
      email,
      role,
      expires_at: expiresAt,
      created_at: now,
    },
    { status: 201 }
  );
}

export async function acceptInvitation(
  env: Env,
  user: { id: string; email: string },
  code: string
): Promise<Response> {
  const now = nowIso();
  const invite = await env.D1_DATABASE.prepare(
    `
    SELECT
      i.id,
      i.project_id,
      i.email,
      i.role,
      i.expires_at,
      i.accepted_at,
      p.deleted_at AS project_deleted_at
    FROM invitations i
    JOIN projects p ON p.id = i.project_id
    WHERE i.code = ?
    `
  )
    .bind(code)
    .first<{
      id: string;
      project_id: string;
      email: string | null;
      role: Role;
      expires_at: string;
      accepted_at: string | null;
      project_deleted_at: string | null;
    }>();

  if (!invite) {
    return notFound('Invitation not found');
  }

  if (invite.accepted_at) {
    return badRequest('Invitation has already been accepted');
  }

  if (invite.project_deleted_at) {
    return notFound('Project no longer exists');
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return badRequest('Invitation has expired');
  }

  if (invite.email && invite.email !== user.email) {
    return forbidden('Invitation is for a different email address');
  }

  const existingMember = await getProjectMember(
    env,
    user.id,
    invite.project_id
  );
  if (existingMember) {
    await env.D1_DATABASE.prepare(
      'UPDATE invitations SET accepted_at = ? WHERE id = ?'
    )
      .bind(now, invite.id)
      .run();

    return Response.json({
      project_id: invite.project_id,
      role: existingMember.role,
      already_member: true,
    });
  }

  // The membership insert is the quota-consuming write. It is inserted via an
  // `INSERT ... SELECT ... WHERE (member count) < limit` guard so the count
  // check and the insert run in a single D1 batch. Concurrent accepts therefore
  // cannot both observe capacity and overshoot the member cap. The invitation's
  // accepted_at is updated only after the membership insert succeeds.
  const maxMembers = getQuotaConfig(env).maxMembersPerProject;
  const primary = env.D1_DATABASE.prepare(
    `
    INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM project_members WHERE project_id = ?
    ) < ?
    `
  ).bind(
    crypto.randomUUID(),
    invite.project_id,
    user.id,
    invite.role,
    now,
    now,
    invite.project_id,
    maxMembers
  );

  const memberQuota = await checkMemberQuota(env, invite.project_id, {
    primary,
    dependents: [
      env.D1_DATABASE.prepare(
        'UPDATE invitations SET accepted_at = ? WHERE id = ?'
      ).bind(now, invite.id),
    ],
  });
  if (memberQuota) return memberQuota;

  return Response.json({
    project_id: invite.project_id,
    role: invite.role,
    accepted: true,
  });
}

export async function updateMemberRole(
  env: Env,
  user: { id: string },
  projectId: string,
  memberId: string,
  body: unknown
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'admin');
  if (access instanceof Response) return access;

  const input = body as { role?: unknown };
  const newRole = normalizeRole(input.role);
  if (!newRole) {
    return badRequest('A valid role is required');
  }

  if (memberId === user.id) {
    return forbidden('You cannot change your own role');
  }

  const currentRole = await getMembershipRole(env, memberId, projectId);
  if (!currentRole) {
    return notFound('Project member not found');
  }

  // Only the project owner may assign or revoke the owner role. This prevents a
  // non-owner admin from minting new owners or demoting the current owner
  // (which would otherwise allow owner lockout or takeover).
  const involvesOwner = newRole === 'owner' || currentRole === 'owner';
  if (involvesOwner && access.role !== 'owner') {
    return forbidden(
      'Only the project owner can assign or change the owner role'
    );
  }

  // Never let a project become ownerless.
  if (currentRole === 'owner' && newRole !== 'owner') {
    const ownerCount = await countOwners(env, projectId);
    if (ownerCount <= 1) {
      return badRequest('Cannot demote the last project owner');
    }
  }

  const updated = await env.D1_DATABASE.prepare(
    'UPDATE project_members SET role = ?, updated_at = ? WHERE project_id = ? AND user_id = ?'
  )
    .bind(newRole, nowIso(), projectId, memberId)
    .run();

  if (updated.meta?.changes === 0) {
    return notFound('Project member not found');
  }

  return Response.json({
    project_id: projectId,
    user_id: memberId,
    role: newRole,
  });
}

export async function removeMember(
  env: Env,
  user: { id: string },
  projectId: string,
  memberId: string
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'owner');
  if (access instanceof Response) return access;

  if (memberId === user.id) {
    return forbidden('Project owner cannot remove themselves');
  }

  const removed = await env.D1_DATABASE.prepare(
    'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
  )
    .bind(projectId, memberId)
    .run();

  if (removed.meta?.changes === 0) {
    return notFound('Project member not found');
  }

  return Response.json({
    project_id: projectId,
    user_id: memberId,
    removed: true,
  });
}

export async function getActivity(
  env: Env,
  user: { id: string },
  projectId: string,
  limit = 100
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId);
  if (access instanceof Response) return access;

  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT
      sc.id,
      sc.change_id,
      sc.project_id,
      sc.actor_id,
      sc.entity_type,
      sc.entity_id,
      sc.operation,
      sc.patch_json,
      sc.base_version,
      sc.client_mutation_id,
      sc.client_id,
      sc.created_at,
      u.email AS actor_email,
      u.display_name AS actor_display_name
    FROM sync_changes sc
    LEFT JOIN users u ON u.id = sc.actor_id
    WHERE sc.project_id = ?
    ORDER BY sc.id DESC
    LIMIT ?
    `
  )
    .bind(projectId, safeLimit)
    .all();

  const changes = (rows.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    change_id: row.change_id,
    project_id: row.project_id,
    actor_id: row.actor_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    operation: row.operation,
    patch: safeJsonParse(row.patch_json as string | null),
    base_version: row.base_version,
    client_mutation_id: row.client_mutation_id,
    client_id: row.client_id,
    created_at: row.created_at,
    actor_email: (row.actor_email as string | null) ?? null,
    actor_display_name: (row.actor_display_name as string | null) ?? null,
  }));

  return Response.json({ changes });
}

function prepareInsertSyncChange(
  env: Env,
  input: {
    projectId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    operation: SyncOperation;
    patch: Record<string, unknown>;
    clientMutationId: string | null;
    clientId: string | null;
    createdAt: string;
  }
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO sync_changes (
      change_id, project_id, actor_id, entity_type, entity_id, operation,
      patch_json, base_version, client_mutation_id, client_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    crypto.randomUUID(),
    input.projectId,
    input.actorId,
    input.entityType,
    input.entityId,
    input.operation,
    JSON.stringify(input.patch),
    null,
    input.clientMutationId,
    input.clientId,
    input.createdAt
  );
}

function prepareIncrementVersion(
  env: Env,
  projectId: string,
  entityType: string,
  entityId: string,
  updatedAt: string
): D1PreparedStatement {
  return env.D1_DATABASE.prepare(
    `
    INSERT INTO entity_versions (project_id, entity_type, entity_id, version, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(project_id, entity_type, entity_id) DO UPDATE SET
      version = version + 1,
      updated_at = excluded.updated_at
    `
  ).bind(projectId, entityType, entityId, updatedAt);
}

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Returns the project's *current* entity set (collections, links, tasks, notes,
 * todos) for reconciliation. Includes soft-deleted rows (`deleted_at IS NOT
 * NULL`) so the client can locally delete entities the server has removed, and
 * attaches the `entity_versions.version` to each row so last-write-wins ties
 * can be broken precisely. Reads existing tables only — no schema migration.
 */
export async function getProjectSnapshot(
  env: Env,
  projectId: string
): Promise<SnapshotResponse> {
  const collections = await fetchSnapshotTable<SnapshotCollection>(
    env,
    projectId,
    'collections',
    'collection',
    [
      'id',
      'project_id',
      'name',
      'description',
      'color',
      'minimized',
      'order_index',
      'bookmark_folder_id',
      'updated_at',
      'deleted_at',
    ]
  );

  const links = await fetchSnapshotTable<SnapshotLink>(
    env,
    projectId,
    'links',
    'link',
    [
      'id',
      'project_id',
      'collection_id',
      'url',
      'title',
      'fav_icon_url',
      'notes',
      'tags_json',
      'order_index',
      'bookmark_id',
      'updated_at',
      'deleted_at',
    ]
  );

  const tasks = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'tasks',
    'task',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  const notes = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'notes',
    'note',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  const todos = await fetchSnapshotTable<SnapshotJsonEntity>(
    env,
    projectId,
    'todos',
    'todo',
    [
      'id',
      'project_id',
      'collection_id',
      'title',
      'payload_json',
      'order_index',
      'updated_at',
      'deleted_at',
    ]
  );

  return { collections, links, tasks, notes, todos };
}

/**
 * Reads every row (live and soft-deleted) of a single entity table for the
 * project, LEFT JOINing `entity_versions` to attach each row's `version`
 * (defaulting to 1 when no version row exists yet).
 */
async function fetchSnapshotTable<T>(
  env: Env,
  projectId: string,
  table: string,
  entityType: string,
  columns: string[]
): Promise<T[]> {
  const colList = columns.map((c) => `t.${c}`).join(', ');
  const rows = await env.D1_DATABASE.prepare(
    `
    SELECT ${colList}, COALESCE(ev.version, 1) AS version
    FROM ${table} t
    LEFT JOIN entity_versions ev
      ON ev.project_id = t.project_id
      AND ev.entity_type = ?
      AND ev.entity_id = t.id
    WHERE t.project_id = ?
    `
  )
    .bind(entityType, projectId)
    .all<T>();

  return rows.results ?? [];
}
