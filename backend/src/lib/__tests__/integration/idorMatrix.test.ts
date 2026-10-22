// Task 5.3 — IDOR matrix against real D1 (openspec/cleanup-and-regression-tests,
// "Real-D1 backend integration tests" → "IDOR matrix fails closed").
//
// ROUTE / HANDLER INVENTORY (what this matrix actually exercises)
// ---------------------------------------------------------------
// The backend has NO per-entity REST routes (no /collections/:id, /links/:id,
// ...). The ONLY write surface for the five synced entity kinds is the sync
// endpoint:
//
//   POST /projects/:id/sync          (backend/src/index.ts:365)
//     → requireUser (JWT)            (index.ts, router-level)
//     → syncProject(env, user, projectId, body, ctx)
//         → requireProjectAccess(env, user.id, projectId, 'editor')
//                                     (src/lib/sync.ts:57 → membership.ts:108)
//         → per-mutation engine       (applyMutation.ts / batched.ts)
//
// Rejection conventions actually implemented (asserted verbatim below):
//   * no membership row            → HTTP 403 "You do not have access to
//                                    this project"        (membership.ts:116)
//   * role below editor (viewer)   → HTTP 403 "Project access requires editor
//                                    role or higher"      (membership.ts:120)
//   * authorized caller targeting a FOREIGN entity id while claiming the
//     route's project              → HTTP 200 sync envelope, per-mutation
//                                    outcome `conflict` "Entity not found or
//                                    already deleted" — the foreign id is
//                                    indistinguishable from a nonexistent one
//                                    (applyMutation.ts:93, batched.ts:214)
//   * mutation claiming a DIFFERENT project than the route → outcome
//     `skipped` reason `project_mismatch`                    (sync.ts:432)
//
// MOVE-ATTEMPT REALITY (per entity kind)
// --------------------------------------
// The sync protocol has NO move operation: `isSyncOperation` admits only
// create/update/delete (sync/shared.ts:130). Moving is expressed as an UPDATE
// of the relocation fields:
//   collection        → reorder = patch.orderIndex
//   link              → re-parent = patch.collectionId (+ optional orderIndex)
//   task/note/todo    → re-parent = patch.collectionId (+ optional orderIndex)
// A cross-project move is impossible by construction: `project_id` is never
// in any UPDATE SET list (sync/statements/*.ts), and a mutation claiming a
// foreign project is skipped as `project_mismatch` before any handler runs.
// The move fan-out (moveFanOut.ts) is unreachable dead wiring by the same
// scoping (applyMutation.ts:135-157 says so explicitly).
//
// MATRIX SHAPE (exactly 45 rejection cells, enumerated below)
// -----------------------------------------------------------
//   5 entity kinds (collection, link, task, note, todo)
//   × 3 operations (update, delete, move-attempt)
//   × 3 roles:
//     member   — EDITOR of MAIN attacking the FOREIGN project's entity THROUGH
//                MAIN's route (mutation claims projectId = MAIN, entityId =
//                foreign id). This is the entity-layer IDOR cell: the engine
//                must scope the foreign id out of existence (404-class
//                per-mutation conflict) and write NOTHING to either project.
//     exMember — membership removed; attacks MAIN's own canonical entity
//                through MAIN's route → route-gate 403, zero state change.
//     viewer   — viewer of MAIN; attacks MAIN's own canonical entity through
//                MAIN's route → route-gate 403 (editor required), zero change.
// Every cell asserts the honest rejection AND zero state change (full row +
// version rows under BOTH projects + both change logs, deep-equal before/after).
//
// Positive controls prove the matrix tests live authorization logic, not dead
// routes: the same member CAN update/move/delete every kind in his own
// project (dedicated control entities), the owner succeeds on his project,
// and the outsider (no membership anywhere) is rejected like the ex-member.

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkersRuntime, getTestEnv } from './harness';
import {
  CANONICAL_ENTITY_IDS,
  ENTITY_KINDS,
  ENTITY_TABLES,
  FIXTURE_USERS,
  FOREIGN_PROJECT_ID,
  MAIN_PROJECT_ID,
  changelogFor,
  fetchRow,
  versionOf,
  type EntityKind,
} from './fixtures';
import {
  FOREIGN_ENTITY_IDS,
  MAIN_SECOND_COLLECTION_ID,
  OWNER_ENTITY_IDS,
  controlEntityId,
  makeMutation,
  movePatchFor,
  seedIdorWorld,
  snapshotCell,
  updatePatchFor,
  type CellSnapshot,
} from './fixtures-idor';
import { syncProject } from '../../sync';
import type { Env, SyncResponse } from '../../../types';

// --- the loud-skip guard (module scope, before any binding access) ----------
const runtimeAvailable = requireWorkersRuntime('IDOR matrix (task 5.3)');
const d = runtimeAvailable ? describe : describe.skip;

/** The three matrix roles and their MAIN-project membership basis. */
const MATRIX_ROLES = ['member', 'exMember', 'viewer'] as const;
type MatrixRole = (typeof MATRIX_ROLES)[number];

/** The three matrix operations ('move' = move-attempt, see header). */
const MATRIX_OPS = ['update', 'delete', 'move'] as const;
type MatrixOp = (typeof MATRIX_OPS)[number];

const NOT_FOUND_CONFLICT_MESSAGE = 'Entity not found or already deleted';

d('IDOR matrix — 5 kinds × update/delete/move × member/ex-member/viewer (real D1)', () => {
  let env: Env;

  beforeAll(async () => {
    env = await getTestEnv();
    await seedIdorWorld(env.D1_DATABASE);
  });

  // -----------------------------------------------------------------------
  // helpers
  // -----------------------------------------------------------------------

  interface MatrixCell {
    kind: EntityKind;
    op: MatrixOp;
    role: MatrixRole;
  }

  /** The exactly-45-cell matrix, explicitly enumerated. */
  const MATRIX: MatrixCell[] = ENTITY_KINDS.flatMap((kind) =>
    MATRIX_OPS.flatMap((op) => MATRIX_ROLES.map((role) => ({ kind, op, role })))
  );

  function mutationFor(cell: MatrixCell) {
    // member cells attack the FOREIGN entity through MAIN's route (entity
    // layer); ex-member/viewer cells attack MAIN's canonical entity (route
    // gate). The move patch always reaches ACROSS the project boundary: the
    // authorized editor pulls toward his own project's collection, the
    // rejected local roles push toward the foreign collection.
    const attacksForeign = cell.role === 'member';
    const entityId = attacksForeign
      ? FOREIGN_ENTITY_IDS[cell.kind]
      : CANONICAL_ENTITY_IDS[cell.kind];
    const targetCollectionId = attacksForeign
      ? CANONICAL_ENTITY_IDS.collection
      : FOREIGN_ENTITY_IDS.collection;

    const patch =
      cell.op === 'delete'
        ? {}
        : cell.op === 'move'
          ? movePatchFor(cell.kind, targetCollectionId)
          : updatePatchFor(cell.kind);

    return makeMutation({
      projectId: MAIN_PROJECT_ID,
      entityType: cell.kind,
      entityId,
      operation: cell.op === 'move' ? 'update' : cell.op,
      patch,
      baseVersion: 1, // honest CAS basis (all seeded entities are at version 1)
      label: `idor-${cell.role}-${cell.kind}-${cell.op}`,
    });
  }

  async function runMatrixCell(cell: MatrixCell): Promise<void> {
    const actor = FIXTURE_USERS[cell.role];
    const mutation = mutationFor(cell);
    const entityId = mutation.entityId;

    const before: CellSnapshot = await snapshotCell(
      env.D1_DATABASE,
      cell.kind,
      entityId
    );

    const res = await syncProject(
      env,
      { id: actor.id },
      MAIN_PROJECT_ID,
      { mutations: [mutation] }
    );

    const after: CellSnapshot = await snapshotCell(
      env.D1_DATABASE,
      cell.kind,
      entityId
    );

    // Zero state change: the targeted row, the entity's version rows under
    // BOTH projects, and BOTH projects' change logs are deep-identical.
    expect(after).toEqual(before);

    if (cell.role === 'member') {
      // Entity-layer IDOR: the authorized editor sees the foreign id as a
      // clean not-found conflict — never as a write, never as a 500.
      expect(res.status).toBe(200);
      const body = (await res.json()) as SyncResponse;
      expect(body.outcomes).toHaveLength(1);
      expect(body.outcomes[0]).toEqual({
        clientMutationId: mutation.clientMutationId,
        status: 'conflict',
        message: NOT_FOUND_CONFLICT_MESSAGE,
      });
      expect(body.changes).toEqual([]);
    } else {
      // Route-gate rejections: HTTP 403 with the role's exact message.
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        cell.role === 'exMember'
          ? 'You do not have access to this project'
          : 'Project access requires editor role or higher'
      );
    }
  }

  // -----------------------------------------------------------------------
  // THE MATRIX — 45 rejection cells
  // -----------------------------------------------------------------------

  it.each(MATRIX)(
    '$role › $op › $kind is rejected with zero state change',
    async (cell) => {
      await runMatrixCell(cell);
    }
  );

  it('the matrix enumerates exactly 45 cells (5 kinds × 3 ops × 3 roles)', () => {
    expect(MATRIX).toHaveLength(45);
    // Every (kind, op, role) combination present exactly once — gaps are
    // visible by construction.
    const seen = new Set(MATRIX.map((c) => `${c.kind}|${c.op}|${c.role}`));
    expect(seen.size).toBe(45);
    for (const kind of ENTITY_KINDS) {
      for (const op of MATRIX_OPS) {
        for (const role of MATRIX_ROLES) {
          expect(seen.has(`${kind}|${op}|${role}`)).toBe(true);
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // Authorized-attacker probes: member claims the FOREIGN project itself
  // -----------------------------------------------------------------------

  const MISMATCH_PROBES = ENTITY_KINDS.flatMap((kind) =>
    MATRIX_OPS.map((op) => ({ kind, op }))
  );

  it.each(MISMATCH_PROBES)(
    'probe: member › $op › $kind claiming the foreign project is skipped as project_mismatch',
    async ({ kind, op }) => {
      const mutation = makeMutation({
        projectId: FOREIGN_PROJECT_ID, // claims the project he is NOT in
        entityType: kind,
        entityId: FOREIGN_ENTITY_IDS[kind],
        operation: op === 'move' ? 'update' : op,
        patch:
          op === 'delete'
            ? {}
            : movePatchFor(kind, FOREIGN_ENTITY_IDS.collection),
        baseVersion: 1,
        label: `idor-mismatch-${kind}-${op}`,
      });

      const before = await snapshotCell(
        env.D1_DATABASE,
        kind,
        FOREIGN_ENTITY_IDS[kind]
      );
      const res = await syncProject(
        env,
        { id: FIXTURE_USERS.member.id },
        MAIN_PROJECT_ID,
        { mutations: [mutation] }
      );
      const after = await snapshotCell(
        env.D1_DATABASE,
        kind,
        FOREIGN_ENTITY_IDS[kind]
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SyncResponse;
      expect(body.outcomes[0]).toEqual({
        clientMutationId: mutation.clientMutationId,
        status: 'skipped',
        reason: 'project_mismatch',
      });
      // The foreign project was never touched (and no phantom rows anywhere).
      expect(after).toEqual(before);
    }
  );

  // -----------------------------------------------------------------------
  // Positive controls — the matrix proves authorization, not dead routes
  // -----------------------------------------------------------------------

  const CONTROL_CELLS = ENTITY_KINDS.flatMap((kind) =>
    MATRIX_OPS.map((op) => ({ kind, op }))
  );

  it.each(CONTROL_CELLS)(
    'control: member CAN $op his own project $kind',
    async ({ kind, op }) => {
      const entityId = controlEntityId(kind, op);
      const patch =
        op === 'delete'
          ? {}
          : op === 'move'
            ? movePatchFor(kind, MAIN_SECOND_COLLECTION_ID)
            : updatePatchFor(kind);

      const mutation = makeMutation({
        projectId: MAIN_PROJECT_ID,
        entityType: kind,
        entityId,
        operation: op === 'move' ? 'update' : op,
        patch,
        baseVersion: 1,
        label: `control-member-${kind}-${op}`,
      });

      const res = await syncProject(
        env,
        { id: FIXTURE_USERS.member.id },
        MAIN_PROJECT_ID,
        { mutations: [mutation] }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SyncResponse;
      expect(body.outcomes[0]).toEqual({
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      });

      const entityRow = await fetchRow(
        env.D1_DATABASE,
        ENTITY_TABLES[kind],
        entityId
      );
      expect(entityRow).toBeDefined();
      // A live row before the op; the delete control flips this below.
      if (op !== 'delete') {
        expect(entityRow?.['deleted_at']).toBeNull();
      }

      if (op === 'update') {
        if (kind === 'collection') {
          expect(entityRow?.['name']).toBe('Renamed collection');
        } else {
          expect(entityRow?.['title']).toBe('Renamed entity');
        }
      }
      if (op === 'move') {
        if (kind === 'collection') {
          expect(entityRow?.['order_index']).toBe(99);
        } else {
          expect(entityRow?.['collection_id']).toBe(MAIN_SECOND_COLLECTION_ID);
        }
      }
      if (op === 'delete') {
        expect(entityRow?.['deleted_at']).not.toBeNull();
      }

      // Exactly one changelog row for this entity, with the honest operation.
      const log = await changelogFor(env.D1_DATABASE, MAIN_PROJECT_ID);
      const rows = log.filter((c) => c.entity_id === entityId);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe(op === 'delete' ? 'delete' : 'update');
      expect(rows[0].actor_id).toBe(FIXTURE_USERS.member.id);
      expect(
        await versionOf(env.D1_DATABASE, MAIN_PROJECT_ID, kind, entityId)
      ).toBe(2);
    }
  );

  it('control: owner CAN update his project entity (sanity)', async () => {
    const mutation = makeMutation({
      projectId: MAIN_PROJECT_ID,
      entityType: 'collection',
      entityId: OWNER_ENTITY_IDS.collection,
      operation: 'update',
      patch: { name: 'Owner-renamed collection' },
      baseVersion: 1,
      label: 'control-owner-update',
    });
    const res = await syncProject(
      env,
      { id: FIXTURE_USERS.owner.id },
      MAIN_PROJECT_ID,
      { mutations: [mutation] }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResponse;
    expect(body.outcomes[0].status).toBe('applied');
    const row = await fetchRow(
      env.D1_DATABASE,
      'collections',
      OWNER_ENTITY_IDS.collection
    );
    expect(row?.['name']).toBe('Owner-renamed collection');
    expect(
      await versionOf(
        env.D1_DATABASE,
        MAIN_PROJECT_ID,
        'collection',
        OWNER_ENTITY_IDS.collection
      )
    ).toBe(2);
  });

  it('control: owner CAN move (reorder) his project entity (sanity)', async () => {
    const mutation = makeMutation({
      projectId: MAIN_PROJECT_ID,
      entityType: 'collection',
      entityId: OWNER_ENTITY_IDS.collection,
      operation: 'update',
      patch: { orderIndex: 7 },
      baseVersion: 2, // the owner-update control above bumped the version
      label: 'control-owner-move',
    });
    const res = await syncProject(
      env,
      { id: FIXTURE_USERS.owner.id },
      MAIN_PROJECT_ID,
      { mutations: [mutation] }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResponse;
    expect(body.outcomes[0].status).toBe('applied');
    const row = await fetchRow(
      env.D1_DATABASE,
      'collections',
      OWNER_ENTITY_IDS.collection
    );
    expect(row?.['order_index']).toBe(7);
  });

  it('control: owner CAN delete his project entity (sanity)', async () => {
    const mutation = makeMutation({
      projectId: MAIN_PROJECT_ID,
      entityType: 'link',
      entityId: OWNER_ENTITY_IDS.link,
      operation: 'delete',
      patch: {},
      baseVersion: 1,
      label: 'control-owner-delete',
    });
    const res = await syncProject(
      env,
      { id: FIXTURE_USERS.owner.id },
      MAIN_PROJECT_ID,
      { mutations: [mutation] }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResponse;
    expect(body.outcomes[0].status).toBe('applied');
    const row = await fetchRow(env.D1_DATABASE, 'links', OWNER_ENTITY_IDS.link);
    expect(row?.['deleted_at']).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Outsider guard — no membership anywhere (extra matrix guard rows)
  // -----------------------------------------------------------------------

  it.each(MATRIX_OPS)(
    'guard: outsider › %s › task is rejected 403 with zero state change',
    async (op) => {
      const mutation = makeMutation({
        projectId: MAIN_PROJECT_ID,
        entityType: 'task',
        entityId: CANONICAL_ENTITY_IDS.task,
        operation: op === 'move' ? 'update' : op,
        patch:
          op === 'delete'
            ? {}
            : movePatchFor('task', FOREIGN_ENTITY_IDS.collection),
        baseVersion: 1,
        label: `guard-outsider-task-${op}`,
      });

      const before = await snapshotCell(
        env.D1_DATABASE,
        'task',
        CANONICAL_ENTITY_IDS.task
      );
      const res = await syncProject(
        env,
        { id: FIXTURE_USERS.outsider.id },
        MAIN_PROJECT_ID,
        { mutations: [mutation] }
      );
      const after = await snapshotCell(
        env.D1_DATABASE,
        'task',
        CANONICAL_ENTITY_IDS.task
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        'You do not have access to this project'
      );
      expect(after).toEqual(before);
    }
  );
});
