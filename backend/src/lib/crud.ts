import { badRequest, notFound } from './response';
import { checkProjectQuota, getQuotaConfig } from './quotas';
import { getLatestChange } from './sync/changelog';
import { notifyRealtime } from './realtime';
import {
  countMembers,
  getProject,
  nowIso,
  requireProjectAccess,
} from './membership';
import {
  prepareIncrementVersion,
  prepareInsertSyncChange,
} from './projectChanges';
import type { Env, Project } from '../types';

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
