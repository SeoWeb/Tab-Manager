import { badRequest, forbidden, notFound } from './response';
import { invitationCreateSchema, parseBody } from './validation';
import { checkMemberQuota, getQuotaConfig } from './quotas';
import {
  getProjectMember,
  requireProjectAccess,
} from './membership';
import { nowIso } from './membership';
import type { Env, Role } from '../types';

export async function createInvitation(
  env: Env,
  user: { id: string },
  projectId: string,
  body: unknown
): Promise<Response> {
  const access = await requireProjectAccess(env, user.id, projectId, 'admin');
  if (access instanceof Response) return access;

  const parsed = parseBody(invitationCreateSchema, body);
  if (!parsed.ok) {
    return badRequest('Invalid request', parsed.details);
  }
  const email = parsed.data.email ?? null;
  const role = parsed.data.role;
  if (role === 'owner') {
    return badRequest('Invitations cannot grant the owner role');
  }
  const { expiresInDays } = parsed.data;
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = nowIso();
  const id = crypto.randomUUID();
  const code = crypto.randomUUID();

  // The invitation is the quota-consuming write. It is inserted via an
  // `INSERT ... SELECT ... WHERE (member count) < limit` guard and runs as
  // PHASE 1 of a two-phase commit — alone — so a tripped guard answers with a
  // structured 403 and nothing else is written. Concurrent invites therefore
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
  // `INSERT ... SELECT ... WHERE (member count) < limit` guard and runs as
  // PHASE 1 of a two-phase commit — alone — so concurrent accepts cannot both
  // observe capacity and overshoot the member cap. When the guard trips, the
  // structured 403 is returned and PHASE 2 (the invitation's accepted_at
  // update) NEVER runs: the invitation row stays unaccepted and remains
  // retryable once capacity frees up.
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
