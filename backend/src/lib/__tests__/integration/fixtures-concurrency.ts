// Concurrency-suite fixtures — task 5.5, openspec/cleanup-and-regression-tests.
//
// LOCAL to this suite: composes the READ-ONLY primitives in `fixtures.ts` into
// race-scenario seeds. `fixtures.ts` is never modified (its header declares
// that a breaking change); everything this suite needs beyond it lives here.
//
// Node-import-safe like the shared fixtures: no `cloudflare:*` imports at
// module scope, every function takes its `D1Database` explicitly.

import type { EntityType, Role, SyncMutation } from '../../../types';
import {
  CODE_EXPIRES_AT,
  NOW,
  seedEntity,
  seedInvitation,
  seedMembership,
  seedProject,
  seedUser,
  seedVersion,
} from './fixtures';

// ---------------------------------------------------------------------------
// Invitation-accept race scenes
// ---------------------------------------------------------------------------

export interface InvitationRaceScene {
  projectId: string;
  ownerId: string;
  invitation: { id: string; code: string };
}

/**
 * Seed a project with only its owner as member, plus ONE pending invitation
 * (the shared resource two concurrent accepts will race on). Fixed literals in
 * — every scene must use unique ids/emails/codes.
 */
export async function seedInvitationRaceScene(
  db: D1Database,
  opts: { projectId: string; ownerId: string; code: string; role?: Role }
): Promise<InvitationRaceScene> {
  await seedUser(db, {
    id: opts.ownerId,
    email: `${opts.ownerId}@tabspace.test`,
    displayName: `Owner ${opts.ownerId}`,
  });
  await seedProject(db, { id: opts.projectId, ownerId: opts.ownerId });
  await seedMembership(db, {
    projectId: opts.projectId,
    userId: opts.ownerId,
    role: 'owner',
  });
  const invitation = await seedInvitation(db, {
    projectId: opts.projectId,
    code: opts.code,
    createdBy: opts.ownerId,
    role: opts.role ?? 'editor',
  });
  return { projectId: opts.projectId, ownerId: opts.ownerId, invitation };
}

export interface RaceUser {
  id: string;
  email: string;
}

/** Seed `count` fresh non-member users to race an invitation accept. */
export async function seedRaceUsers(
  db: D1Database,
  prefix: string,
  count: number
): Promise<RaceUser[]> {
  const users: RaceUser[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${i}`;
    const email = `${prefix}-${i}@tabspace.test`;
    await seedUser(db, { id, email, displayName: `Racer ${prefix}-${i}` });
    users.push({ id, email });
  }
  return users;
}

// ---------------------------------------------------------------------------
// Login-code verify / brute-force races
// ---------------------------------------------------------------------------

/**
 * A `POST /auth/verify` request carrying the JSON content-type that
 * `readJson` requires (login.ts parses the body itself — no rate limiting or
 * CORS wrapper in between when the handler is driven directly).
 */
export function verifyLoginCodeRequest(email: string, code: string): Request {
  return new Request('https://backend.test/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
}

// ---------------------------------------------------------------------------
// CAS version-conflict scenes
// ---------------------------------------------------------------------------

export interface CasScene {
  projectId: string;
  task: { id: string; baseVersion: number };
  writers: { id: string }[];
}

/**
 * Seed a minimal write scene for the sync CAS: a project, an owner and an
 * editor (both write-capable, modeling two racing clients), and one live task
 * with an entity_versions row at `baseVersion`.
 */
export async function seedCasScene(
  db: D1Database,
  opts: {
    projectId: string;
    taskId: string;
    baseVersion?: number;
    editorId?: string;
  }
): Promise<CasScene> {
  const ownerId = `${opts.projectId}-owner`;
  const editorId = opts.editorId ?? `${opts.projectId}-editor`;
  await seedUser(db, {
    id: ownerId,
    email: `${ownerId}@tabspace.test`,
    displayName: `Owner ${opts.projectId}`,
  });
  await seedUser(db, {
    id: editorId,
    email: `${editorId}@tabspace.test`,
    displayName: `Editor ${opts.projectId}`,
  });
  await seedProject(db, { id: opts.projectId, ownerId });
  await seedMembership(db, {
    projectId: opts.projectId,
    userId: ownerId,
    role: 'owner',
  });
  await seedMembership(db, {
    projectId: opts.projectId,
    userId: editorId,
    role: 'editor',
  });
  const baseVersion = opts.baseVersion ?? 1;
  await seedEntity(db, 'task', {
    id: opts.taskId,
    projectId: opts.projectId,
    title: 'CAS task',
    payloadJson: '{}',
  });
  await seedVersion(db, {
    projectId: opts.projectId,
    entityType: 'task',
    entityId: opts.taskId,
    version: baseVersion,
  });
  return {
    projectId: opts.projectId,
    task: { id: opts.taskId, baseVersion },
    writers: [{ id: ownerId }, { id: editorId }],
  };
}

let mutationCounter = 0;

/** A minimal valid sync `update` mutation with a unique clientMutationId. */
export function updateMutation(opts: {
  projectId: string;
  entityType?: EntityType;
  entityId: string;
  baseVersion: number;
  patch: Record<string, unknown>;
}): SyncMutation {
  mutationCounter += 1;
  return {
    clientMutationId: `cmid-concurrency-${mutationCounter}`,
    entityType: opts.entityType ?? 'task',
    entityId: opts.entityId,
    projectId: opts.projectId,
    operation: 'update',
    baseVersion: opts.baseVersion,
    patch: opts.patch,
    clientId: 'concurrency-suite',
    createdAt: NOW,
  } as SyncMutation;
}

export interface SyncResponseBody {
  cursor: number;
  changes: { id: number; entity_type: string; entity_id: string }[];
  conflicts: {
    entityType: string;
    entityId: string;
    clientMutationId: string;
    message: string;
    currentVersion: number;
    expectedVersion: number | undefined;
  }[];
  outcomes: {
    clientMutationId: string;
    status: 'applied' | 'conflict' | 'skipped' | 'error';
    message?: string;
    reason?: string;
  }[];
  reconcileRequired?: boolean;
}

/** Parse a `POST /projects/:id/sync` response body. */
export async function syncResponseBody(
  response: Response
): Promise<SyncResponseBody> {
  return (await response.json()) as SyncResponseBody;
}

// Re-exported so the suite file only imports fixtures from ONE module.
export { CODE_EXPIRES_AT, NOW };
