import { readJson, writeJson, CLOUD_SYNC_STORAGE_KEYS } from './storage';
import type { CloudMutation } from './types';

/**
 * The local-first mutation queue.
 *
 * Mutations are appended here as the user edits while offline or before a sync
 * runs, and removed once the server acknowledges them (i.e. they are not in the
 * returned conflicts). Deduped by `clientMutationId`, which the server also uses
 * to apply mutations idempotently.
 */

export async function getQueue(): Promise<CloudMutation[]> {
  const stored = await readJson<CloudMutation[] | null>(
    CLOUD_SYNC_STORAGE_KEYS.queue,
    null
  );
  return Array.isArray(stored) ? stored : [];
}

export async function getQueueLength(): Promise<number> {
  return (await getQueue()).length;
}

/** Append a mutation, deduping by `clientMutationId`. Returns the new queue. */
export async function enqueueMutation(
  mutation: CloudMutation
): Promise<CloudMutation[]> {
  const queue = await getQueue();
  if (queue.some((m) => m.clientMutationId === mutation.clientMutationId)) {
    return queue;
  }
  const next = [...queue, mutation];
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
  return next;
}

/** Remove mutations by `clientMutationId` (those the server accepted). */
export async function removeMutations(
  clientMutationIds: string[]
): Promise<CloudMutation[]> {
  if (clientMutationIds.length === 0) return getQueue();
  const ids = new Set(clientMutationIds);
  const next = (await getQueue()).filter((m) => !ids.has(m.clientMutationId));
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, next);
  return next;
}

export async function clearQueue(): Promise<void> {
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.queue, []);
}

/** The subset of queued mutations targeting a single project. */
export async function getQueueForProject(
  projectId: string
): Promise<CloudMutation[]> {
  return (await getQueue()).filter((m) => m.projectId === projectId);
}
