import {
  readJson,
  writeJson,
  CLOUD_SYNC_STORAGE_KEYS,
} from '@/lib/cloudflareSync/storage';
import type { CloudMutation, DirtyFields } from './types';

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
