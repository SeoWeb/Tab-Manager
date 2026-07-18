import { useAppStore } from '@/stores/appStore';
import * as config from '../config';
import * as queue from '../queue';
import { setCloudState } from './internal';
import type { CloudEntityType, CloudOperation, CloudMutation } from '../types';

/**
 * Enqueue a mutation only when cloud sync is enabled AND the owning project is
 * cloud-enabled. This is the single guarded entry point Phase 3 entity actions
 * call; it keeps the cloud/local distinction out of every action. Returns whether
 * a mutation was actually enqueued. Failures (e.g. storage errors) are logged and
 * swallowed so a sync hiccup never blocks the optimistic local update.
 */
export async function enqueueCloudChange(input: {
  projectId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
}): Promise<boolean> {
  const { cloudSync, projects } = useAppStore.getState();
  if (!cloudSync.enabled) return false;
  const project = projects.find((p) => p.id === input.projectId);
  if (!project?.cloudEnabled) return false;

  try {
    await enqueueCloudMutation({
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      patch: input.patch,
      ...(input.baseVersion !== undefined
        ? { baseVersion: input.baseVersion }
        : {}),
    });
    return true;
  } catch (error) {
    console.error('[cloud-sync] failed to enqueue mutation', error);
    return false;
  }
}

/**
 * Enqueue a local mutation. Called by Phase 3 entity actions when cloud sync is
 * enabled. Fills in `clientMutationId`, `clientId`, and `createdAt`.
 */
export async function enqueueCloudMutation(
  mutation: Omit<CloudMutation, 'clientMutationId' | 'clientId' | 'createdAt'> &
    Partial<Pick<CloudMutation, 'clientMutationId' | 'baseVersion'>>
): Promise<void> {
  const clientId = await config.getClientId();
  const full: CloudMutation = {
    clientMutationId: mutation.clientMutationId ?? crypto.randomUUID(),
    clientId,
    createdAt: new Date().toISOString(),
    projectId: mutation.projectId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    patch: mutation.patch,
    ...(mutation.baseVersion !== undefined
      ? { baseVersion: mutation.baseVersion }
      : {}),
  };

  const next = await queue.enqueueMutation(full);
  setCloudState({
    pendingMutationCount: next.length,
    pendingEdits: queue.pendingEditsFromQueue(next),
  });
}
