import { describe, it, expect, beforeEach } from 'vitest';
import { syncProject } from '../sync';
import type { Env, SyncMutationOutcome } from '../../types';
import type { DB } from './cases/harness';
import {
  makeEnv,
  baseDb,
  versionOf,
  NOW,
} from './cases/harness';

/**
 * Per-mutation outcome tests (change `secure-sync-backend` §2.4 + §3.3 at the
 * endpoint surface):
 *
 * - the response carries an `outcomes` array with EXACTLY one entry per
 *   submitted mutation, in submission order;
 * - non-create mutations claiming another project get an explicit
 *   `project_mismatch` skip (previously a silent `continue`);
 * - invalid per-mutation entries get `invalid_mutation`;
 * - the top-level `conflicts` array stays populated for compatibility;
 * - resubmitting the same create (same clientMutationId) is answered `applied`
 *   while the entity and its changelog row are created exactly once.
 */

interface SyncResponseBody {
  cursor: number;
  changes: unknown[];
  conflicts: {
    entityType: string;
    entityId: string;
    clientMutationId: string;
    message: string;
    currentVersion: number;
    expectedVersion?: number;
  }[];
  outcomes: SyncMutationOutcome[];
}

function dbWithEditor(): DB {
  const db = baseDb();
  db.project_members = [
    { project_id: 'p1', user_id: 'u1', role: 'editor' },
  ];
  return db;
}

function syncBody(mutations: Record<string, unknown>[]): Record<string, unknown> {
  return { lastCursor: null, mutations };
}

function baseFields(clientMutationId: string): Record<string, unknown> {
  return {
    clientMutationId,
    projectId: 'p1',
    clientId: 'client-1',
    createdAt: NOW,
  };
}

describe('per-mutation outcomes in the sync response (§2.4)', () => {
  let db: DB;
  let env: Env;

  beforeEach(() => {
    db = dbWithEditor();
    env = makeEnv(db);
  });

  it('exactly one outcome per submitted mutation, in submission order', async () => {
    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      syncBody([
        {
          ...baseFields('cm-1'),
          entityType: 'task',
          entityId: 't-live',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'x' },
        },
        {
          ...baseFields('cm-2'),
          projectId: 'p2', // mismatched project
          entityType: 'task',
          entityId: 't-live',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'y' },
        },
        {
          ...baseFields('cm-3'),
          entityType: 'task',
          entityId: 'missing-entity',
          operation: 'update',
          baseVersion: 2,
          patch: {},
        },
        {
          ...baseFields('cm-4'),
          entityType: 'task',
          entityId: 't-live',
          operation: 'update', // no baseVersion → skipped
          patch: { title: 'z' },
        },
        {
          // Invalid per-mutation entry (missing patch/projectId/...).
          clientMutationId: 'cm-5',
          entityType: 'task',
        },
        {
          ...baseFields('cm-6'),
          entityType: 'task',
          entityId: 't-new',
          operation: 'create',
          patch: { title: 'created' },
        },
      ])
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes).toHaveLength(6);
    expect(body.outcomes.map((o) => o.clientMutationId)).toEqual([
      'cm-1',
      'cm-2',
      'cm-3',
      'cm-4',
      'cm-5',
      'cm-6',
    ]);
    expect(body.outcomes.map((o) => o.status)).toEqual([
      'applied',
      'skipped',
      'conflict',
      'skipped',
      'skipped',
      'applied',
    ]);
    expect(body.outcomes[1]?.reason).toBe('project_mismatch');
    expect(body.outcomes[3]?.reason).toBe('missing_base_version');
    expect(body.outcomes[4]?.reason).toBe('invalid_mutation');
    expect(body.outcomes[2]?.message).toBe('Entity not found or already deleted');

    // Compatibility: the top-level conflicts array is still populated.
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]?.clientMutationId).toBe('cm-3');

    // Only cm-1 and cm-6 wrote: one update change row + one create change row.
    expect(db.sync_changes).toHaveLength(2);
    expect(versionOf(db, 't-live')).toBe(3);
    expect(versionOf(db, 't-new')).toBe(1);
    expect(db.tasks.find((t) => t.id === 't-new')?.title).toBe('created');
  });

  it('a non-create mutation claiming another project is skipped with project_mismatch and writes nothing', async () => {
    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      syncBody([
        {
          ...baseFields('cm-foreign'),
          projectId: 'p2',
          entityType: 'task',
          entityId: 't-live',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'hijack' },
        },
      ])
    );

    const body = (await response.json()) as SyncResponseBody;
    // Regression: this used to be a silent `continue` — it now has an outcome.
    expect(body.outcomes).toHaveLength(1);
    expect(body.outcomes[0]).toEqual({
      clientMutationId: 'cm-foreign',
      status: 'skipped',
      reason: 'project_mismatch',
    });
    expect(body.conflicts).toHaveLength(0);
    expect(versionOf(db, 't-live')).toBe(2);
    expect(db.sync_changes).toHaveLength(0);
  });

  it('a create claiming another project keeps its legacy conflict AND gets a project_mismatch outcome', async () => {
    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      syncBody([
        {
          ...baseFields('cm-create-p2'),
          projectId: 'p2',
          entityType: 'task',
          entityId: 't-other',
          operation: 'create',
          patch: { title: 'smuggled' },
        },
      ])
    );

    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes).toHaveLength(1);
    expect(body.outcomes[0]?.status).toBe('skipped');
    expect(body.outcomes[0]?.reason).toBe('project_mismatch');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]?.clientMutationId).toBe('cm-create-p2');
    expect(body.conflicts[0]?.message).toBe(
      'Mutation project id does not match sync project id'
    );
    expect(db.sync_changes).toHaveLength(0);
    expect(db.tasks.some((t) => t.id === 't-other')).toBe(false);
  });
});

describe('resubmission of the same create at the endpoint (§3.3)', () => {
  it('second request is answered applied; entity + changelog row exist exactly once', async () => {
    const db = dbWithEditor();
    const env = makeEnv(db);
    const body = syncBody([
      {
        ...baseFields('cm-once'),
        entityType: 'task',
        entityId: 't-new',
        operation: 'create',
        patch: { title: 'once' },
      },
    ]);

    const first = await syncProject(env, { id: 'u1' }, 'p1', body);
    const firstBody = (await first.json()) as SyncResponseBody;
    expect(firstBody.outcomes[0]?.status).toBe('applied');

    const second = await syncProject(env, { id: 'u1' }, 'p1', body);
    const secondBody = (await second.json()) as SyncResponseBody;
    expect(secondBody.outcomes[0]?.status).toBe('applied');

    // Created exactly once across both requests.
    expect(db.tasks.filter((t) => t.id === 't-new')).toHaveLength(1);
    expect(versionOf(db, 't-new')).toBe(1);
    expect(
      db.sync_changes.filter(
        (c) =>
          c.client_mutation_id === 'cm-once' && c.project_id === 'p1'
      )
    ).toHaveLength(1);
  });
});
