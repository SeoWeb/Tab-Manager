import { badRequest, forbidden, notFound } from './response';
import { checkMemberQuota, getQuotaConfig } from './quotas';
import {
  getProjectMember,
  requireProjectAccess,
} from './membership';
import { nowIso } from './membership';
import type { Env, Role } from '../types';

const roleRank: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

const validRoles = new Set<string>(Object.keys(roleRank));

function normalizeRole(value: unknown): Role | null {
  return typeof value === 'string' && validRoles.has(value)
    ? (value as Role)
    : null;
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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

  const email = parseOptionalString(input.email)?.trim().toLowerCase();
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
