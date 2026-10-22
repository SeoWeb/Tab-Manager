import { describe, it, expect } from 'vitest';
import { syncProject } from '../sync';
import type { Env, SyncMutation } from '../../types';
import { makeEnv, baseDb, versionOf, NOW, type DB } from './cases/harness';

/**
 * Lagging-client detection in the sync response (scale-sync-backend,
 * change-log-retention, "Pruning preserves reconcile correctness"):
 *
 * - a client whose incremental cursor predates the project's pruning horizon
 *   (`project_sync_meta.max_pruned_change_id`) is STALE: the response flags
 *   `reconcileRequired: true`, carries `changes: []` (the delta would span the
 *   pruned window), and the client must converge via the snapshot endpoint;
 * - mutations are STILL applied on the stale path (CAS baseVersions protect
 *   correctness; outcomes are real);
 * - active clients (cursor >= horizon), projects without a meta row (never
 *   pruned), and initial syncs (no lastCursor) are NOT flagged and get the
 *   unchanged incremental response.
 *
 * The pruning side (which WRITES the `project_sync_meta` rows for both the
 * retention window and the count cap) is covered by `changelogPruning.test.ts`
 * — "retention prune: ... records the horizon" and "count-cap prune: ...".
 * Here the meta row is seeded exactly as pruning leaves it.
 */

/** Shape of a `project_sync_meta` row (migration 0007). */
interface MetaRow {
  project_id: string;
  horizon_created_at: string;
  max_pruned_change_id: number;
  updated_at: string;
}

/** The one statement the staleness check issues. */
const META_SELECT =
  /SELECT max_pruned_change_id FROM project_sync_meta WHERE project_id = \?/;

/**
 * Wrap the shared sync-engine harness mock with `project_sync_meta` support:
 * the staleness SELECT is answered from `meta`, every other statement is
 * delegated to the harness unchanged.
 */
function withSyncMeta(env: Env, meta: MetaRow[]): Env {
  const db = env.D1_DATABASE;
  const wrapped = {
    ...db,
    prepare(sql: string) {
      if (META_SELECT.test(sql)) {
        return {
          bind(projectId: string) {
            return {
              async first(): Promise<MetaRow | null> {
                return meta.find((m) => m.project_id === projectId) ?? null;
              },
            };
          },
        };
      }
      return db.prepare(sql);
    },
  };
  return { ...env, D1_DATABASE: wrapped } as unknown as Env;
}

function metaRow(projectId: string, maxPruned: number): MetaRow {
  return {
    project_id: projectId,
    horizon_created_at: '2025-01-01T00:00:00.000Z',
    max_pruned_change_id: maxPruned,
    updated_at: NOW,
  };
}

/** Editor membership on p1 plus two historical (partly pruned) change rows. */
function dbWithHistory(): DB {
  const db = baseDb();
  db.project_members = [
    { project_id: 'p1', user_id: 'u1', role: 'editor' },
  ];
  // History: ids 1..2 predate the (seeded) pruning horizon; the mutation
  // submitted by each test becomes id 3.
  db.sync_changes = [
    {
      id: 1,
      project_id: 'p1',
      entity_id: 't-live',
      operation: 'update',
      client_mutation_id: 'old-1',
    },
    {
      id: 2,
      project_id: 'p1',
      entity_id: 't-live',
      operation: 'update',
      client_mutation_id: 'old-2',
    },
  ];
  return db;
}

function updateMutation(clientMutationId: string): SyncMutation {
  return {
    clientMutationId,
    projectId: 'p1',
    entityType: 'task',
    entityId: 't-live',
    operation: 'update',
    baseVersion: 2,
    patch: { title: 'updated' },
    clientId: 'client-1',
    createdAt: NOW,
  };
}

interface ResponseBody {
  cursor: number;
  changes: { id: number }[];
  reconcileRequired?: boolean;
  outcomes: { clientMutationId: string; status: string }[];
}

describe('lagging-client detection in the sync response', () => {
  it('stale cursor (< max_pruned_change_id with a meta row): flags reconcileRequired with empty changes but still applies mutations', async () => {
    const db = dbWithHistory();
    const env = withSyncMeta(makeEnv(db), [metaRow('p1', 2)]);

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      { lastCursor: 1, mutations: [updateMutation('cm-stale')] }
    );
    const body = (await response.json()) as ResponseBody;

    // Flagged: the delta is skipped BY DESIGN (it would span the pruned
    // window) and the client is directed to the snapshot endpoint.
    expect(body.reconcileRequired).toBe(true);
    expect(body.changes).toEqual([]);
    // ...at a sane cursor: the fresh max change id for the project (the row
    // this request just inserted — ids 1..2 were history, the mutation is 3).
    expect(body.cursor).toBe(3);
    // Mutations are STILL applied as normal: real outcome + real version bump.
    expect(body.outcomes).toEqual([
      { clientMutationId: 'cm-stale', status: 'applied' },
    ]);
    expect(versionOf(db, 't-live')).toBe(3);
  });

  it('active cursor (== max_pruned_change_id): no flag, normal incremental response', async () => {
    const db = dbWithHistory();
    const env = withSyncMeta(makeEnv(db), [metaRow('p1', 2)]);

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      { lastCursor: 2, mutations: [updateMutation('cm-active')] }
    );
    const body = (await response.json()) as ResponseBody;

    // Strictly-below predicate: the horizon id itself is NOT stale. The flag
    // is absent entirely (byte-identical response shape to the pre-flag API).
    expect('reconcileRequired' in body).toBe(false);
    expect(body.changes.map((c) => c.id)).toEqual([3]);
    expect(body.cursor).toBe(3);
    expect(body.outcomes).toEqual([
      { clientMutationId: 'cm-active', status: 'applied' },
    ]);
  });

  it('no meta row (never pruned): no flag even for an old cursor', async () => {
    const db = dbWithHistory();
    const env = withSyncMeta(makeEnv(db), []);

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      { lastCursor: 1, mutations: [updateMutation('cm-nometa')] }
    );
    const body = (await response.json()) as ResponseBody;

    expect('reconcileRequired' in body).toBe(false);
    expect(body.changes.map((c) => c.id)).toEqual([2, 3]);
    expect(body.cursor).toBe(3);
  });

  it('initial sync (no lastCursor): no flag even with a meta row', async () => {
    const db = dbWithHistory();
    const env = withSyncMeta(makeEnv(db), [metaRow('p1', 2)]);

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      { lastCursor: null, mutations: [updateMutation('cm-initial')] }
    );
    const body = (await response.json()) as ResponseBody;

    // An initial sync pulls from scratch anyway — the pruned window is
    // irrelevant to it.
    expect('reconcileRequired' in body).toBe(false);
    expect(body.changes.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(body.cursor).toBe(3);
  });
});
