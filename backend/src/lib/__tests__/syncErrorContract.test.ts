import { describe, it, expect } from 'vitest';
import { applyMutation } from '../sync';
import {
  buildCreateStatements,
  INVALID_MUTATION_PATCH_MESSAGE,
} from '../sync/mutations';
import { MutationPatchError, requireString } from '../sync/shared';
import { internalError } from '../response';
import type { DB, Env } from './cases/harness';
import { makeEnv, baseDb, versionOf, mutation, NOW } from './cases/harness';

/**
 * Error-contract tests (change `secure-sync-backend` §1.4, updated by §2/§3):
 *
 * - The sync engine's OWN invalid-patch signals (`MutationPatchError` thrown by
 *   `requireString` and the type mappers) become per-mutation conflicts with a
 *   FIXED, client-safe message — never the raw error text.
 * - Everything else (simulated D1 failures, constraint violations) PROPAGATES
 *   out of applyMutation/buildCreateStatements so the top-level handler logs it
 *   and answers `500 retryable` — never a 200 with a fake conflict entry.
 * - Project deletion via sync requires the owner role (mirrors the HTTP route).
 * - Updates carry a mandatory `baseVersion` (§2.2) — the mutations below pin it
 *   to the entity's current version so they exercise the patch path.
 */

const D1_FAILURE = new Error('D1_ERROR: no such table: entity_versions: INTERNAL');
/**
 * A constraint violation on an ENTITY table is infrastructure and must
 * propagate. (A UNIQUE violation on `sync_changes` is different: since
 * migration 0004 it means the same (project_id, client_mutation_id) already
 * committed, and §3.3 maps it to an idempotent success — see
 * syncIdempotency.test.ts.)
 */
const ENTITY_CONSTRAINT_FAILURE = new Error('UNIQUE constraint failed: tasks.id');

function dbWithLiveLink(): DB {
  const db = baseDb();
  db.links.push({
    id: 'l-live',
    project_id: 'p1',
    collection_id: null,
    url: 'https://example.com',
    title: null,
    fav_icon_url: null,
    notes: null,
    tags_json: null,
    order_index: null,
    bookmark_id: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  });
  return db;
}

function dbWithMembers(
  members: { project_id: string; user_id: string; role: string }[]
): DB {
  const db = baseDb();
  db.project_members = members;
  return db;
}

/** Wrap a harness env so `batch` always throws (simulated D1 outage). */
function envWithBatchFailure(base: Env, error: Error): Env {
  const d1 = base.D1_DATABASE;
  return {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => d1.prepare(sql),
      batch: async () => {
        throw error;
      },
    },
  } as unknown as Env;
}

/** Wrap a harness env so one specific SQL read throws mid-statement-build. */
function envWhereReadThrows(
  base: Env,
  sqlPattern: RegExp,
  error: Error
): Env {
  const d1 = base.D1_DATABASE;
  return {
    ...base,
    D1_DATABASE: {
      prepare(sql: string) {
        if (sqlPattern.test(sql)) {
          return {
            bind: () => ({
              first: async () => {
                throw error;
              },
              all: async () => {
                throw error;
              },
              run: async () => {
                throw error;
              },
            }),
          };
        }
        return d1.prepare(sql);
      },
      batch: (stmts: Parameters<typeof d1.batch>[0]) => d1.batch(stmts),
    },
  } as unknown as Env;
}

/** Fixed messages must be the ONLY thing clients can see — assert equality. */
function expectFixedMessage(message: string): void {
  expect(message).toBe(INVALID_MUTATION_PATCH_MESSAGE);
  expect(message).not.toMatch(/SELECT|INSERT|UPDATE\s|UNIQUE|CONSTRAINT|D1_/i);
}

describe('known invalid-patch errors become fixed-message conflicts', () => {
  it('update link with an empty url → fixed conflict, no raw error text', async () => {
    const db = dbWithLiveLink();
    const env = makeEnv(db);
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'link',
        entityId: 'l-live',
        operation: 'update',
        baseVersion: 1,
        patch: { url: '' },
      })
    );

    expect(result.conflict).toBeDefined();
    expectFixedMessage(result.conflict?.message ?? '');
    expect(versionOf(db, 'l-live')).toBeUndefined(); // no write occurred
  });

  it('update link with a wrong-type url behaves identically', async () => {
    const env = makeEnv(dbWithLiveLink());
    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'link',
        entityId: 'l-live',
        operation: 'update',
        baseVersion: 1,
        patch: { url: 42 },
      })
    );

    expectFixedMessage(result.conflict?.message ?? '');
  });

  it('create link without a url (buildCreateStatements) → fixed conflict', async () => {
    const env = makeEnv(dbWithLiveLink());
    const built = await buildCreateStatements(
      env,
      'u1',
      mutation({
        entityType: 'link',
        entityId: 'l-new',
        operation: 'create',
        patch: { title: 'no url' },
      }),
      NOW,
      '(0) < 1',
      ['p1'],
      false,
      0
    );

    expect('conflict' in built).toBe(true);
    if ('conflict' in built) expectFixedMessage(built.conflict.message);
  });
});

describe('infrastructure failures propagate (never 200-with-conflict)', () => {
  it('a D1 batch failure during apply rejects with the original error', async () => {
    const env = envWithBatchFailure(makeEnv(dbWithLiveLink()), D1_FAILURE);

    await expect(
      applyMutation(
        env,
        'u1',
        mutation({
          entityType: 'task',
          entityId: 't-live',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'x' },
        })
      )
    ).rejects.toThrow('D1_ERROR: no such table');
  });

  it('a constraint violation during apply is NOT disguised as a conflict', async () => {
    const env = envWithBatchFailure(
      makeEnv(dbWithLiveLink()),
      ENTITY_CONSTRAINT_FAILURE
    );

      await expect(
        applyMutation(
          env,
          'u1',
          mutation({
            entityType: 'task',
            entityId: 't-live',
            operation: 'delete',
          })
        )
      ).rejects.toThrow('UNIQUE constraint failed: tasks.id');
  });

  it('a non-patch read failure inside statement building rethrows', async () => {
    const env = envWhereReadThrows(
      makeEnv(dbWithLiveLink()),
      /SELECT collection_id, url/, // the live-row read inside prepareUpdateLink
      new Error('D1_ERROR: disk I/O error')
    );

    await expect(
      applyMutation(
        env,
        'u1',
        mutation({
          entityType: 'link',
          entityId: 'l-live',
          operation: 'update',
          baseVersion: 1,
          patch: { title: 'x' },
        })
      )
    ).rejects.toThrow('disk I/O error');
  });
});

describe('MutationPatchError (the typed invalid-patch signal)', () => {
  it('requireString raises the typed error', () => {
    expect(() => requireString({ url: '' }, 'url')).toThrow(
      MutationPatchError
    );
  });

  it('distinguishes the engine signal from infrastructure errors via instanceof', () => {
    expect(new MutationPatchError('url must be a non-empty string')).toBeInstanceOf(
      MutationPatchError
    );
    expect(new Error('Unsupported entity type')).not.toBeInstanceOf(
      MutationPatchError
    );
    expect(D1_FAILURE).not.toBeInstanceOf(MutationPatchError);
    expect(ENTITY_CONSTRAINT_FAILURE).not.toBeInstanceOf(MutationPatchError);
    // Non-Error values are never patch errors.
    expect('url must be a non-empty string').not.toBeInstanceOf(
      MutationPatchError
    );
    expect(null).not.toBeInstanceOf(MutationPatchError);
  });
});

describe('sync-driven project deletion is owner-only', () => {
  it('admin (non-owner) gets a fixed role conflict and nothing is written', async () => {
    const db = dbWithMembers([
      { project_id: 'p1', user_id: 'u2', role: 'admin' },
    ]);
    const env = makeEnv(db);

    const result = await applyMutation(
      env,
      'u2',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'delete',
      })
    );

    expect(result.conflict?.message).toBe(
      'Project deletion requires owner role'
    );
    expect(
      db.projects.find((p) => p.id === 'p1')?.deleted_at
    ).toBeNull();
    expect(db.sync_changes).toHaveLength(0);
  });

  it('owner succeeds: project soft-deleted, version bumped, change logged', async () => {
    const db = dbWithMembers([
      { project_id: 'p1', user_id: 'u1', role: 'owner' },
    ]);
    const env = makeEnv(db);

    const result = await applyMutation(
      env,
      'u1',
      mutation({
        entityType: 'project',
        entityId: 'p1',
        projectId: 'p1',
        operation: 'delete',
      })
    );

    expect(result.conflict).toBeUndefined();
    expect(db.projects.find((p) => p.id === 'p1')?.deleted_at).not.toBeNull();
    expect(versionOf(db, 'p1')).toBe(1);
    expect(db.sync_changes).toHaveLength(1);
    expect(db.sync_changes[0]?.operation).toBe('delete');
  });
});

describe('internalError() response shape', () => {
  it('returns 500 with a fixed message and the retryable hint only', async () => {
    const response = internalError();

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { message: string; retryable: boolean };
    };
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.retryable).toBe(true);
    // No internals on the wire.
    expect(JSON.stringify(body)).not.toMatch(/SELECT|D1_|constraint/i);
  });
});
