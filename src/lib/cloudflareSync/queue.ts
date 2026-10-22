import {
  readJson,
  writeJson,
  CLOUD_SYNC_STORAGE_KEYS,
} from '@tabspace/shared/lib/cloudflareSync/storage';
import { gateMutationsByOutcomes } from './outcomes';
import type { CloudMutation, DirtyFields, SyncMutationOutcome } from './types';

/**
 * Derive the set of entity field names a mutation's patch would write. Used to
 * track which fields have pending (un-pushed) local edits so incoming remote
 * changes to those same fields can be flagged as conflicts. `collectionId` is a
 * server-binding hint, not a mergeable entity field, so it is excluded.
 */
export function dirtyFieldsFromPatch(patch: Record<string, unknown>): string[] {
  const payload = (patch.payload ?? {}) as Record<string, unknown>;
  const fields = new Set<string>();
  if ('title' in patch) fields.add('title');
  for (const key of Object.keys(payload)) {
    if (key === 'collectionId') continue;
    fields.add(key);
  }
  return [...fields];
}

/**
 * Rebuild the full dirty-field map from the current mutation queue. An entity's
 * dirty fields are the union of every pending `update`/`create` mutation's
 * written fields (a `delete` only clears nothing here; its fields drop out once
 * the mutation is removed). Called after every enqueue and after a sync drains
 * the queue, so `pendingEdits` always reflects what is still unsynced.
 */
export function pendingEditsFromQueue(queue: CloudMutation[]): DirtyFields {
  const result: DirtyFields = {};
  for (const mutation of queue) {
    if (mutation.operation === 'delete') continue;
    const fields = dirtyFieldsFromPatch(mutation.patch);
    if (fields.length === 0) continue;
    const existing = result[mutation.entityId] ?? [];
    result[mutation.entityId] = [...new Set([...existing, ...fields])];
  }
  return result;
}

/**
 * The local-first mutation queue.
 *
 * Mutations are appended here as the user edits while offline or before a sync
 * runs, and removed once the server acknowledges them (i.e. they are not in the
 * returned conflicts). Deduped by `clientMutationId`, which the server also uses
 * to apply mutations idempotently.
 *
 * Conflicted entries (fix-cross-context-data-loss 7.1): a CAS rejection does
 * NOT delete the mutation. The entry stays queued flagged `conflicted` and is
 * released only by an applied resolution or an explicit user discard
 * (`releaseConflictedForEntity`). Flagged entries are excluded from pushes
 * (`getPushableQueueForProject`) because retrying a CAS rejection can never
 * succeed — retention replaces deletion, the wire payload does not change.
 */

let queueLock: Promise<unknown> = Promise.resolve();

async function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const nextLock = queueLock.then(async () => {
    return operation();
  });
  queueLock = nextLock.catch(() => {}); // prevent lock chain rejection from blocking subsequent tasks
  return nextLock;
}

async function getQueueInternal(): Promise<CloudMutation[]> {
  const stored = await readJson<CloudMutation[] | null>(
    CLOUD_SYNC_STORAGE_KEYS.queue,
    null
  );
  return Array.isArray(stored) ? stored : [];
}

export async function getQueue(): Promise<CloudMutation[]> {
  return getQueueInternal();
}

export async function getQueueLength(): Promise<number> {
  return (await getQueueInternal()).length;
}

/** Append a mutation, deduping by `clientMutationId`. Returns the new queue. */
export async function enqueueMutation(
  mutation: CloudMutation
): Promise<CloudMutation[]> {
  return runSerialized(async () => {
    const queue = await getQueueInternal();
    if (queue.some((m) => m.clientMutationId === mutation.clientMutationId)) {
      return queue;
    }

    const next = [...queue, mutation];
    await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
    return next;
  });
}

/** Remove mutations by `clientMutationId` (those the server accepted). */
export async function removeMutations(
  clientMutationIds: string[]
): Promise<CloudMutation[]> {
  if (clientMutationIds.length === 0) return getQueueInternal();
  return runSerialized(async () => {
    const ids = new Set(clientMutationIds);
    const next = (await getQueueInternal()).filter(
      (m) => !ids.has(m.clientMutationId)
    );
    await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
    return next;
  });
}

/** Pure helper: how many of these queue entries are flagged conflicted. */
export function countConflicted(queue: readonly CloudMutation[]): number {
  return queue.filter((m) => m.conflicted === true).length;
}

/** How many queued mutations are flagged conflicted (for the sync status UI). */
export async function getConflictedCount(): Promise<number> {
  return countConflicted(await getQueueInternal());
}

/**
 * The subset of queued mutations targeting a single project that should be
 * PUSHED: conflicted entries are excluded — they are retained locally until
 * resolution, but retrying a CAS rejection can never succeed, so they are not
 * re-sent. (Everything else about the push payload is unchanged.)
 */
export async function getPushableQueueForProject(
  projectId: string
): Promise<CloudMutation[]> {
  return (await getQueueInternal()).filter(
    (m) => m.projectId === projectId && m.conflicted !== true
  );
}

/** What `settleMutationOutcomes` did to the queue in one serialized write. */
export interface MutationSettlement {
  /** The queue after settlement (conflicted entries flagged and retained). */
  queue: CloudMutation[];
  /** Entries removed — the server finalized them (`applied`/`skipped`). */
  released: CloudMutation[];
  /** Entries now flagged `conflicted` (retained until resolution/discard). */
  conflicted: CloudMutation[];
}

/**
 * Settle pushed mutations against their sync outcomes in ONE serialized
 * read-modify-write: `applied`/`skipped` entries are removed, `conflict`
 * entries are flagged `conflicted` and retained, `error`/missing entries stay
 * queued untouched (the gate logs those). Matching is by `clientMutationId`.
 */
export async function settleMutationOutcomes(
  pushed: readonly CloudMutation[],
  outcomes: readonly SyncMutationOutcome[] | undefined
): Promise<MutationSettlement> {
  return runSerialized(async () => {
    const queue = await getQueueInternal();
    const { settled, conflicted } = gateMutationsByOutcomes(pushed, outcomes);
    const settledIds = new Set(settled.map((m) => m.clientMutationId));
    const conflictedIds = new Set(conflicted.map((m) => m.clientMutationId));

    const next: CloudMutation[] = [];
    const released: CloudMutation[] = [];
    const conflictedNow: CloudMutation[] = [];
    for (const mutation of queue) {
      if (settledIds.has(mutation.clientMutationId)) {
        released.push(mutation);
        continue;
      }
      if (conflictedIds.has(mutation.clientMutationId)) {
        // Flag in place (idempotent for entries already flagged by an earlier
        // sync) and keep the entry queued — the local edit survives.
        const flagged =
          mutation.conflicted === true
            ? mutation
            : { ...mutation, conflicted: true };
        conflictedNow.push(flagged);
        next.push(flagged);
        continue;
      }
      next.push(mutation);
    }

    if (released.length > 0 || conflictedNow.length > 0) {
      await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
    }
    return { queue: next, released, conflicted: conflictedNow };
  });
}

/**
 * Release every conflicted mutation targeting one entity. This is the
 * resolution-side release path (fix-cross-context-data-loss 7.1): field-level
 * conflict items carry no `clientMutationId`, so release is keyed by
 * (projectId, entityType, entityId) — every conflicted mutation for the entity
 * is superseded once the user resolves or discards its conflict. Non-conflicted
 * entries for the same entity (e.g. a fresh resolution push) are preserved.
 */
export async function releaseConflictedForEntity(entity: {
  projectId: string;
  entityType: CloudMutation['entityType'];
  entityId: string;
}): Promise<CloudMutation[]> {
  return runSerialized(async () => {
    const queue = await getQueueInternal();
    const next = queue.filter(
      (m) =>
        !(
          m.conflicted === true &&
          m.projectId === entity.projectId &&
          m.entityType === entity.entityType &&
          m.entityId === entity.entityId
        )
    );
    if (next.length === queue.length) return queue;
    await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
    return next;
  });
}

export async function clearQueue(): Promise<void> {
  return runSerialized(async () => {
    await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, []);
  });
}

/** The subset of queued mutations targeting a single project. */
export async function getQueueForProject(
  projectId: string
): Promise<CloudMutation[]> {
  return (await getQueueInternal()).filter((m) => m.projectId === projectId);
}
