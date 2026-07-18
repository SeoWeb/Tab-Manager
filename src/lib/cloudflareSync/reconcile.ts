import {
  buildCollectionPatch,
  buildLinkPatch,
  buildNotePatch,
  buildTodoPatch,
  buildTaskPatch,
} from './entityPatches';
import type {
  CloudEntityType,
  CloudOperation,
  CloudSyncChange,
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
} from './types';
import {
  type DiffSnapshotLocal,
  type DiffSnapshotResult,
  type Lww,
  type PushItem,
  type SnapshotRow,
  parseDate,
} from './reconcileCore/types';
import {
  collectionPullPatch,
  jsonPullPatch,
  linkPullPatch,
  todoEqualsServer,
} from './reconcileCore/pullPatches';

/**
 * Pure reconciliation engine.
 *
 * `diffSnapshot` compares the local store's entities for one project against the
 * server's *current* entity set (the `GET /projects/:id/snapshot` response) and
 * classifies every entity into one of:
 *
 * - **create-locally** — server has it (not deleted), local missing
 * - **update-locally** — both present, server is newer (last-write-wins by
 *   `updated_at`, ties broken by `version`)
 * - **delete-locally** — server row is marked deleted, local still has it
 * - **push-to-server** — local present, no server row (new local item), or local
 *   is newer than the server row
 *
 * Pulls (create/update/delete-locally) are emitted as synthetic `CloudSyncChange`
 * rows tagged `client_id: null` so the existing `applyRemoteChanges` reducer folds
 * them in exactly like real remote changes (reusing nesting + conflict detection).
 * Pushes (local-newer / local-only) are returned as `PushItem`s for the caller to
 * enqueue as normal cloud mutations.
 *
 * Project reconciliation is intentionally excluded: the snapshot endpoint returns
 * only the project's sub-entities (collections, links, tasks, notes, todos), never
 * the project row itself, so there is no server truth to compare the project
 * against.
 *
 * The `queuedEntityIds` set implements the D9 guard: any entity that already has a
 * pending, unsynced local mutation is treated as locally authoritative — its pull
 * (and push) classification is skipped so a stale snapshot cannot resurrect a
 * locally-deleted/edited item. The queued mutation reconciles on the next
 * incremental sync instead.
 */

export type {
  DiffSnapshotLocal,
  DiffSnapshotResult,
  PushItem,
} from './reconcileCore/types';

let pullChangeId = 1_000_000;

export function diffSnapshot(
  input: DiffSnapshotLocal & {
    server: SnapshotResponse;
    queuedEntityIds?: Iterable<string>;
  }
): DiffSnapshotResult {
  const { server, queuedEntityIds } = input;
  const queued = queuedEntityIds ? new Set(queuedEntityIds) : new Set<string>();
  const pulls: CloudSyncChange[] = [];
  const pushes: PushItem[] = [];

  // Links are nested under collections; flatten them and remember their parent
  // so push patches can supply the collection id (the Link type has none).
  const links: import('@/types').Link[] = [];
  const linkCollectionId = new Map<string, string>();
  for (const collection of input.collections) {
    for (const link of collection.links) {
      links.push(link);
      linkCollectionId.set(link.id, collection.id);
    }
  }

  diffEntities<import('@/types').Collection, SnapshotCollection>(
    {
      entityType: 'collection',
      serverRows: server.collections,
      localItems: input.collections,
      getId: (e) => e.id,
      localUpdatedAt: (e) => e.updatedAt ?? null,
      pullPatch: collectionPullPatch,
      pushPatch: (e) => buildCollectionPatch(e),
      projectId: server.collections[0]?.project_id ?? '',
    },
    queued,
    pulls,
    pushes
  );

  diffEntities<import('@/types').Link, SnapshotLink>(
    {
      entityType: 'link',
      serverRows: server.links,
      localItems: links,
      getId: (e) => e.id,
      // Legacy links persisted before `updatedAt` existed have it undefined;
      // treat a missing `updatedAt` as `createdAt` (task 3.3 backfill) so they do
      // not always compare as older and lose every LWW tie.
      localUpdatedAt: (e) => e.updatedAt ?? e.createdAt ?? null,
      pullPatch: linkPullPatch,
      pushPatch: (e) => {
        const collectionId = linkCollectionId.get(e.id);
        return collectionId ? buildLinkPatch(collectionId, e) : null;
      },
      projectId: server.links[0]?.project_id ?? '',
    },
    queued,
    pulls,
    pushes
  );

  diffEntities<import('@/types/tasks').AdvancedTask, SnapshotJsonEntity>(
    {
      entityType: 'task',
      serverRows: server.tasks,
      localItems: input.tasks,
      getId: (e) => e.id,
      localUpdatedAt: (e) => e.updatedAt ?? null,
      pullPatch: jsonPullPatch,
      pushPatch: (e) => buildTaskPatch(e),
      projectId: server.tasks[0]?.project_id ?? '',
    },
    queued,
    pulls,
    pushes
  );

  diffEntities<import('@/stores/types').Note, SnapshotJsonEntity>(
    {
      entityType: 'note',
      serverRows: server.notes,
      localItems: input.notes,
      getId: (e) => e.id,
      localUpdatedAt: (e) => e.updatedAt ?? null,
      pullPatch: jsonPullPatch,
      pushPatch: (e) => buildNotePatch(e),
      projectId: server.notes[0]?.project_id ?? '',
    },
    queued,
    pulls,
    pushes
  );

  // Legacy todos carry no timestamp, so LWW falls back to content equality.
  diffEntities<import('@/types/tasks').LegacyTask, SnapshotJsonEntity>(
    {
      entityType: 'todo',
      serverRows: server.todos,
      localItems: input.todos,
      getId: (e) => e.id,
      localUpdatedAt: () => null,
      pullPatch: jsonPullPatch,
      pushPatch: (e) => buildTodoPatch(e),
      localEqualsServer: todoEqualsServer,
      projectId: server.todos[0]?.project_id ?? '',
    },
    queued,
    pulls,
    pushes
  );

  return { pulls, pushes };
}

interface EntitySpec<E, S extends SnapshotRow> {
  entityType: CloudEntityType;
  serverRows: S[];
  localItems: E[];
  getId: (e: E) => string;
  /** Local `updatedAt`, or null when the entity has no usable timestamp. */
  localUpdatedAt: (e: E) => Date | null;
  pullPatch: (row: S) => Record<string, unknown>;
  pushPatch: (e: E) => Record<string, unknown> | null;
  /** Content equality for entity types without a usable timestamp (e.g. todo). */
  localEqualsServer?: (e: E, row: S) => boolean;
  projectId: string;
}

function diffEntities<E, S extends SnapshotRow>(
  spec: EntitySpec<E, S>,
  queued: Set<string>,
  pulls: CloudSyncChange[],
  pushes: PushItem[]
): void {
  const localById = new Map<string, E>();
  for (const item of spec.localItems) localById.set(spec.getId(item), item);

  for (const row of spec.serverRows) {
    const id = row.id;
    // D9: an entity with a queued local mutation is locally authoritative —
    // skip the pull classification so a stale snapshot cannot resurrect it.
    if (queued.has(id)) continue;

    const local = localById.get(id);

    if (row.deleted_at) {
      if (local) {
        pulls.push(
          makePull(spec, id, 'delete', {}, row.updated_at, row.version)
        );
      }
      continue;
    }

    if (!local) {
      pulls.push(
        makePull(
          spec,
          id,
          'create',
          spec.pullPatch(row),
          row.updated_at,
          row.version
        )
      );
      continue;
    }

    const serverUpdatedAt = parseDate(row.updated_at) ?? new Date(0);
    const lww = compareLww({
      localUpdatedAt: spec.localUpdatedAt(local),
      serverUpdatedAt,
      serverVersion: row.version,
      localEqualsServer: spec.localEqualsServer
        ? spec.localEqualsServer(local, row)
        : undefined,
    });

    if (lww === 'server') {
      pulls.push(
        makePull(
          spec,
          id,
          'update',
          spec.pullPatch(row),
          row.updated_at,
          row.version
        )
      );
    } else if (lww === 'local') {
      const patch = spec.pushPatch(local);
      if (patch) {
        pushes.push({
          entityType: spec.entityType,
          entityId: id,
          operation: 'update',
          patch,
          baseVersion: row.version,
        });
      }
    }
    // 'equal' → in sync, nothing to do.
  }

  // Local-only entities: present locally, absent from the server snapshot.
  for (const item of spec.localItems) {
    const id = spec.getId(item);
    if (queued.has(id)) continue;
    const hasServer = spec.serverRows.some((r) => r.id === id);
    if (hasServer) continue;
    const patch = spec.pushPatch(item);
    if (patch) {
      pushes.push({
        entityType: spec.entityType,
        entityId: id,
        operation: 'create',
        patch,
      });
    }
  }
}

function makePull(
  spec: { entityType: CloudEntityType; projectId: string },
  entityId: string,
  operation: CloudOperation,
  patch: Record<string, unknown>,
  updatedAt: string,
  version: number
): CloudSyncChange {
  return {
    id: pullChangeId++,
    change_id: `reconcile:${spec.entityType}:${entityId}:${operation}`,
    project_id: spec.projectId,
    actor_id: 'server',
    entity_type: spec.entityType,
    entity_id: entityId,
    operation,
    patch,
    base_version: version,
    client_mutation_id: null,
    // Tagged null so applyRemoteChanges never skips it as our own echo.
    client_id: null,
    created_at: updatedAt,
  };
}

/**
 * Last-write-wins comparison. Server wins on a strictly newer `updated_at`; a
 * tie is broken by `version`; a further tie is treated as equal (in sync).
 *
 * When the local entity has no usable timestamp (`localUpdatedAt` is null, as for
 * legacy todos), we cannot determine recency, so we fall back to content equality:
 * equal content means in-sync, differing content means keep the local value
 * (push), which is the safe local-first choice.
 */
function compareLww(params: {
  localUpdatedAt: Date | null;
  serverUpdatedAt: Date;
  serverVersion?: number;
  localEqualsServer?: boolean;
}): Lww {
  const { localUpdatedAt, serverUpdatedAt, serverVersion, localEqualsServer } =
    params;

  if (localUpdatedAt === null) {
    return localEqualsServer ? 'equal' : 'local';
  }

  const localMs = localUpdatedAt.getTime();
  const serverMs = serverUpdatedAt.getTime();
  if (serverMs > localMs) return 'server';
  if (serverMs < localMs) return 'local';

  const lv = 0;
  const sv = serverVersion ?? 0;
  if (sv > lv) return 'server';
  if (lv > sv) return 'local';
  return 'equal';
}
