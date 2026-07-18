import type { Link, Collection } from '@/types';
import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput } from './shared';
import {
  patchOf,
  pickString,
  pickNumber,
  pickStringArray,
  parseDate,
} from './shared';

export function applyLink(
  state: ApplyChangesInput,
  change: CloudSyncChange
): boolean {
  const project = state.projects.find((p) => p.id === change.project_id);
  if (!project) return false;

  const patch = patchOf(change);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    for (const collection of project.collections) {
      collection.links = collection.links.filter((l) => l.id !== id);
    }
    return true;
  }

  if (change.operation === 'create') {
    const collectionId = pickString([patch.collectionId]);
    const collection = collectionId
      ? project.collections.find((c) => c.id === collectionId)
      : project.collections[0];
    if (!collection) return false;
    if (collection.links.some((l) => l.id === id)) return true;
    collection.links.push(buildLink(id, patch, change.created_at));
    return true;
  }

  // update — find the link's current collection anywhere in the project
  const sourceCollection = project.collections.find((c) =>
    c.links.some((l) => l.id === id)
  );
  if (!sourceCollection) return false;

  // A `collectionId` patch reassigns the link to another collection (a
  // cross-collection move). Links render by array position, not the `order`
  // field, so the link must be physically relocated — merging in place would
  // leave it stranded in its old collection on the receiving client.
  const reassignedTo = pickString([patch.collectionId]);
  if (reassignedTo && reassignedTo !== sourceCollection.id) {
    const target = project.collections.find((c) => c.id === reassignedTo);
    if (!target) return false; // target collection not synced locally yet
    const moved = sourceCollection.links.find((l) => l.id === id);
    if (!moved) return false;
    sourceCollection.links = sourceCollection.links.filter((l) => l.id !== id);
    target.links.push(mergeLink(moved, patch));
    if ('order' in patch) {
      sortLinksByOrder(sourceCollection);
      sortLinksByOrder(target);
    }
    return true;
  }

  // Same-collection update — merge field updates in place.
  sourceCollection.links = sourceCollection.links.map((l) =>
    l.id === id ? mergeLink(l, patch) : l
  );
  // An `order` update repositions the link; since links render by array
  // position, re-sort by `order` (id tiebreaker keeps it deterministic when
  // orders collide). The sender pushes every shifted link's new order, so once
  // the batch settles this reproduces its arrangement.
  if ('order' in patch) sortLinksByOrder(sourceCollection);
  return true;
}

export function buildLink(
  id: string,
  patch: Record<string, unknown>,
  createdAt: string
): Link {
  // Reconcile pulls carry the server's `updated_at` in the patch so the local
  // link preserves it for last-write-wins comparison; the incremental sync path
  // leaves it absent and falls back to "now" (the link was just touched).
  const updatedAt =
    parseDate(patch.updated_at ?? patch.updatedAt) ??
    parseDate(createdAt) ??
    new Date();
  return {
    id,
    url: pickString([patch.url]) ?? '',
    title: pickString([patch.title]),
    favIconUrl: pickString([patch.favIconUrl, patch.faviconUrl]),
    tags: pickStringArray([patch.tags]),
    notes: pickString([patch.notes]),
    order: pickNumber([patch.order, patch.orderIndex]),
    bookmarkId: pickString([patch.bookmarkId]) ?? null,
    createdAt: parseDate(createdAt) ?? new Date(),
    updatedAt,
  };
}

export function mergeLink(
  link: Link,
  patch: Record<string, unknown>
): Link {
  const updatedAt =
    parseDate(patch.updated_at ?? patch.updatedAt) ?? link.updatedAt;
  return {
    ...link,
    url: pickString([patch.url]) ?? link.url,
    title: 'title' in patch ? pickString([patch.title]) : link.title,
    favIconUrl:
      'favIconUrl' in patch || 'faviconUrl' in patch
        ? pickString([patch.favIconUrl, patch.faviconUrl])
        : link.favIconUrl,
    tags:
      'tags' in patch
        ? (pickStringArray([patch.tags]) ?? link.tags)
        : link.tags,
    notes: 'notes' in patch ? pickString([patch.notes]) : link.notes,
    order: pickNumber([patch.order, patch.orderIndex]) ?? link.order,
    bookmarkId: pickString([patch.bookmarkId]) ?? link.bookmarkId ?? null,
    // Reconcile pulls preserve the server `updated_at`; local updates leave the
    // existing value untouched.
    updatedAt,
  };
}

/**
 * Sort a collection's links by their `order` field. Links render by array
 * position (not `order`), so a remote reorder or cross-collection move only
 * shows up if we reposition the array; `id` is a stable tiebreaker when two
 * links share an order (e.g. mid-batch before all sibling orders arrive).
 */
export function sortLinksByOrder(collection: Collection): void {
  collection.links = [...collection.links].sort((a, b) => {
    const byOrder = (a.order ?? 0) - (b.order ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
