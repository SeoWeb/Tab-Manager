import { badRequest, notFound } from './response';
import {
  parseBody,
  projectCreateSchema,
  projectUpdateSchema,
} from './validation';
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

export async function createProject(
  env: Env,
  owner: { id: string },
  body: unknown
): Promise<Response> {
  const parsed = parseBody(projectCreateSchema, body);
  if (!parsed.ok) {
    return badRequest('Invalid request', parsed.details);
  }
  const { name } = parsed.data;
  const description = parsed.data.description ?? null;
  const color = parsed.data.color ?? null;
  const icon = parsed.data.icon ?? null;

  const now = nowIso();
  const id = crypto.randomUUID();
  const patch = { id, name, description, color, icon, owner_id: owner.id };

  // The project row is the quota-consuming write. It is inserted via an
  // `INSERT ... SELECT ... WHERE (count) < limit` guard and runs as PHASE 1 of
  // a two-phase commit — alone, so when the guard trips (cap reached) the
  // request is answered with a structured 403 and NO dependent statement ever
  // executes (D1 batches would otherwise run them all). PHASE 2 — the owner
  // membership, version seed, and change log — runs only once the project row
  // is known to exist, so a quota breach can never orphan rows. Concurrent
  // creates still cannot both observe capacity and overshoot the cap: the
  // guard lives in the insert's WHERE clause, so at most one wins the final
  // slot.
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

  const parsed = parseBody(projectUpdateSchema, body);
  if (!parsed.ok) {
    return badRequest('Invalid request', parsed.details);
  }
  const input = parsed.data;

  const existing = await env.D1_DATABASE.prepare(
    'SELECT id, name, description, color, icon FROM projects WHERE id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first<Project>();

  if (!existing) {
    return notFound('Project not found');
  }

  // The schema trims and length-validates `name` identically to create, so the
  // value applied here is the trimmed one (a whitespace-only name 400s before
  // this point). Absent fields fall back to the stored values.
  const name = input.name === undefined ? existing.name : input.name;
  if (!name) {
    return badRequest('Project name cannot be empty');
  }

  const description =
    input.description === undefined ? existing.description : input.description;
  const color = input.color === undefined ? existing.color : input.color;
  const icon = input.icon === undefined ? existing.icon : input.icon;
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
  // Deletion is owner-only: an admin (non-owner) must not be able to destroy
  // the project. Mirrors the sync-driven deletion path in sync/mutations.ts.
  const access = await requireProjectAccess(env, user.id, projectId, 'owner');
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
