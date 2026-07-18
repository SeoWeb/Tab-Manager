import { badRequest, forbidden, notFound } from './response';
import type {
  Env,
  Project,
  ProjectMember,
  Role,
} from '../types';

const roleRank: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

const validRoles = new Set<string>(Object.keys(roleRank));

export function nowIso(): string {
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
