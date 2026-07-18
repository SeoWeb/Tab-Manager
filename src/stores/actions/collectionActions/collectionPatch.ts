import type { Collection } from '@/types';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';

/**
 * Build the cloud patch for a collection update from local `updates`, keeping
 * only fields the Worker stores. Bookmark folder ids are device-local and
 * excluded.
 */
export function buildCollectionUpdatePatch(
  updates: Partial<Collection>
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.description !== undefined)
    patch.description = updates.description;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.minimized !== undefined) patch.minimized = updates.minimized;
  if (updates.order !== undefined) patch.order = updates.order;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Enqueue an `update` mutation carrying each collection's current order. */
export function syncCollectionOrders(
  projectId: string,
  collections: Collection[]
): void {
  for (const collection of collections) {
    void enqueueCloudChange({
      projectId,
      entityType: 'collection',
      entityId: collection.id,
      operation: 'update',
      patch: { order: collection.order ?? 0 },
    });
  }
}
