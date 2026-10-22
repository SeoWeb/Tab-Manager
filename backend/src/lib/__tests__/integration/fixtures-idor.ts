// IDOR-matrix fixtures — task 5.3, openspec/cleanup-and-regression-tests.
//
// Per the READ-ONLY contract on fixtures.ts, this file does NOT modify the
// canonical seeders: it imports them and layers the extra deterministic rows
// the matrix needs on top of `seedCanonicalWorld`:
//
//   * one live entity of each kind in FOREIGN_PROJECT_ID (the outsider-owned
//     project the canonical world leaves empty) — the IDOR attack targets;
//   * a second live collection in MAIN — the "move into" collection for the
//     positive move controls;
//   * dedicated positive-control entities (one per kind × op) so controls
//     never consume the canonical rows the matrix cells snapshot;
//   * two owner-owned sanity entities.
//
// It also carries the shared SyncMutation factory and the per-cell state
// snapshot used for every "zero state change" assertion.

import {
  CANONICAL_ENTITY_IDS,
  ENTITY_KINDS,
  ENTITY_TABLES,
  FOREIGN_PROJECT_ID,
  MAIN_PROJECT_ID,
  NOW,
  changelogFor,
  countLiveEntities,
  fetchRow,
  seedCanonicalWorld,
  seedEntity,
  seedVersion,
  versionOf,
  type ChangelogRow,
  type EntityKind,
} from './fixtures';
import type { EntityType, SyncMutation, SyncOperation } from '../../../types';

// ---------------------------------------------------------------------------
// Fixed ids
// ---------------------------------------------------------------------------

/** Live entity of each kind in the FOREIGN (outsider-owned) project. */
export const FOREIGN_ENTITY_IDS: Record<EntityKind, string> = {
  collection: 'xf-collection',
  link: 'xf-link',
  task: 'xf-task',
  note: 'xf-note',
  todo: 'xf-todo',
};

/** Second live collection in MAIN — positive move controls move into it. */
export const MAIN_SECOND_COLLECTION_ID = 'c-main-2';

/** Dedicated control entity per (kind, op) — positive controls only. */
export function controlEntityId(kind: EntityKind, op: string): string {
  return `xc-${kind}-${op}`;
}

/** Owner-owned sanity entities (the "owner succeeds" rows). */
export const OWNER_ENTITY_IDS = {
  collection: 'xo-collection',
  link: 'xo-link',
} as const;

// ---------------------------------------------------------------------------
// Mutation factory
// ---------------------------------------------------------------------------

export interface MakeMutationOptions {
  projectId: string;
  entityType: EntityKind;
  entityId: string;
  operation: SyncOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
  /** Unique label — becomes the clientMutationId (dedupe-safe per cell). */
  label: string;
}

/** Build a wire-valid SyncMutation with deterministic ids. */
export function makeMutation(opts: MakeMutationOptions): SyncMutation {
  return {
    clientMutationId: `cmid-${opts.label}`,
    projectId: opts.projectId,
    entityType: opts.entityType as EntityType,
    entityId: opts.entityId,
    operation: opts.operation,
    patch: opts.patch,
    ...(opts.baseVersion === undefined ? {} : { baseVersion: opts.baseVersion }),
    clientId: 'integration-test-client',
    createdAt: NOW,
  };
}

/** Field edit for the `update` cells — one honest, kind-appropriate field. */
export function updatePatchFor(kind: EntityKind): Record<string, unknown> {
  if (kind === 'collection') {
    return { name: 'Renamed collection' };
  }
  return { title: 'Renamed entity' };
}

/**
 * Relocation patch for the `move-attempt` cells. The sync API has NO move
 * operation (create/update/delete only — see `isSyncOperation`); moving is an
 * UPDATE of the relocation fields:
 *   collection → reordering (order_index)
 *   link/task/note/todo → re-parenting (collection_id) + optional reorder.
 * `targetCollectionId` is the collection the cell tries to move INTO.
 */
export function movePatchFor(
  kind: EntityKind,
  targetCollectionId: string
): Record<string, unknown> {
  if (kind === 'collection') {
    return { orderIndex: 99 };
  }
  return { collectionId: targetCollectionId, orderIndex: 99 };
}

// ---------------------------------------------------------------------------
// Zero-state-change snapshot (the assertion primitive of every matrix cell)
// ---------------------------------------------------------------------------

export interface CellSnapshot {
  /** Full row of the targeted entity id (whichever project holds it). */
  targetRow: Record<string, unknown> | undefined;
  /** The id's version row under BOTH projects — catches phantom CAS bumps. */
  versionInMain: number | undefined;
  versionInForeign: number | undefined;
  /** Both projects' change logs — catches phantom changelog rows. */
  mainChangelog: ChangelogRow[];
  foreignChangelog: ChangelogRow[];
}

/**
 * Capture everything a rejected mutation could possibly have touched for one
 * entity id: its row, its version rows (both projects), and both projects'
 * change logs. Cells assert `after` deep-equals `before`.
 */
export async function snapshotCell(
  db: D1Database,
  kind: EntityKind,
  entityId: string
): Promise<CellSnapshot> {
  const [targetRow, versionInMain, versionInForeign, mainChangelog, foreignChangelog] =
    await Promise.all([
      fetchRow(db, ENTITY_TABLES[kind], entityId),
      versionOf(db, MAIN_PROJECT_ID, kind, entityId),
      versionOf(db, FOREIGN_PROJECT_ID, kind, entityId),
      changelogFor(db, MAIN_PROJECT_ID),
      changelogFor(db, FOREIGN_PROJECT_ID),
    ]);
  return {
    targetRow,
    versionInMain,
    versionInForeign,
    mainChangelog,
    foreignChangelog,
  };
}

// Re-exported for cell implementations (keeps test files to one fixture import).
export {
  CANONICAL_ENTITY_IDS,
  ENTITY_KINDS,
  ENTITY_TABLES,
  FOREIGN_PROJECT_ID,
  MAIN_PROJECT_ID,
  changelogFor,
  countLiveEntities,
  fetchRow as fetchEntityRow,
  versionOf,
};

// ---------------------------------------------------------------------------
// World seeding
// ---------------------------------------------------------------------------

/**
 * The canonical world PLUS the IDOR-matrix layers. Call once from beforeAll;
 * every id is a fixed literal (per-file storage isolation keeps files apart).
 */
export async function seedIdorWorld(db: D1Database): Promise<void> {
  await seedCanonicalWorld(db);

  // Foreign targets: one live entity of each kind, version 1 (CAS basis).
  for (const kind of ENTITY_KINDS) {
    await seedEntity(db, kind, {
      id: FOREIGN_ENTITY_IDS[kind],
      projectId: FOREIGN_PROJECT_ID,
    });
    await seedVersion(db, {
      projectId: FOREIGN_PROJECT_ID,
      entityType: kind,
      entityId: FOREIGN_ENTITY_IDS[kind],
      version: 1,
    });
  }

  // Second MAIN collection for the positive move controls.
  await seedEntity(db, 'collection', {
    id: MAIN_SECOND_COLLECTION_ID,
    orderIndex: 1,
  });
  await seedVersion(db, {
    projectId: MAIN_PROJECT_ID,
    entityType: 'collection',
    entityId: MAIN_SECOND_COLLECTION_ID,
    version: 1,
  });

  // Dedicated control entities (kind × op), version 1 — never touched by the
  // matrix cells, so controls and matrix stay order-independent.
  for (const kind of ENTITY_KINDS) {
    for (const op of ['update', 'move', 'delete'] as const) {
      const id = controlEntityId(kind, op);
      await seedEntity(db, kind, {
        id,
        collectionId:
          kind === 'collection' ? undefined : CANONICAL_ENTITY_IDS.collection,
      });
      await seedVersion(db, {
        projectId: MAIN_PROJECT_ID,
        entityType: kind,
        entityId: id,
        version: 1,
      });
    }
  }

  // Owner sanity entities, version 1.
  await seedEntity(db, 'collection', { id: OWNER_ENTITY_IDS.collection });
  await seedVersion(db, {
    projectId: MAIN_PROJECT_ID,
    entityType: 'collection',
    entityId: OWNER_ENTITY_IDS.collection,
    version: 1,
  });
  await seedEntity(db, 'link', {
    id: OWNER_ENTITY_IDS.link,
    collectionId: CANONICAL_ENTITY_IDS.collection,
  });
  await seedVersion(db, {
    projectId: MAIN_PROJECT_ID,
    entityType: 'link',
    entityId: OWNER_ENTITY_IDS.link,
    version: 1,
  });
}
