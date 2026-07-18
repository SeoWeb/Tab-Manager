import type { Collection } from '@/types';
import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput } from './shared';
import {
  patchOf,
  pickString,
  pickNumber,
  parseDate,
} from './shared';

export function applyCollection(
  state: ApplyChangesInput,
  change: CloudSyncChange
): boolean {
  const project = state.projects.find((p) => p.id === change.project_id);
  if (!project) return false;

  const patch = patchOf(change);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    project.collections = project.collections.filter((c) => c.id !== id);
    return true;
  }

  if (change.operation === 'create') {
    if (project.collections.some((c) => c.id === id)) return true;
    project.collections.push(buildCollection(id, patch, change.created_at));
    return true;
  }

  let found = false;
  project.collections = project.collections.map((c) => {
    if (c.id !== id) return c;
    found = true;
    return mergeCollection(c, patch);
  });
  return found;
}

export function buildCollection(
  id: string,
  patch: Record<string, unknown>,
  createdAt: string
): Collection {
  // Reconcile pulls carry the server's `updated_at` so the local collection keeps
  // it for last-write-wins comparison; the incremental sync path leaves it absent
  // and falls back to the change's created_at.
  const updatedAt =
    parseDate(patch.updated_at ?? patch.updatedAt) ??
    parseDate(createdAt) ??
    new Date();
  return {
    id,
    name: pickString([patch.name]) ?? 'Untitled',
    description: pickString([patch.description]),
    links: [],
    createdAt: parseDate(createdAt) ?? new Date(),
    updatedAt,
    color: pickString([patch.color]),
    minimized: patch.minimized === true,
    order: pickNumber([patch.order, patch.orderIndex]),
    bookmarkFolderId: pickString([patch.bookmarkFolderId]) ?? null,
  };
}

export function mergeCollection(
  collection: Collection,
  patch: Record<string, unknown>
): Collection {
  return {
    ...collection,
    name: pickString([patch.name]) ?? collection.name,
    description: pickString([patch.description]) ?? collection.description,
    color: 'color' in patch ? pickString([patch.color]) : collection.color,
    minimized:
      patch.minimized === undefined
        ? collection.minimized
        : patch.minimized === true,
    order: pickNumber([patch.order, patch.orderIndex]) ?? collection.order,
    bookmarkFolderId:
      pickString([patch.bookmarkFolderId]) ??
      collection.bookmarkFolderId ??
      null,
    // Reconcile pulls preserve the server `updated_at`; local updates leave it.
    updatedAt:
      parseDate(patch.updated_at ?? patch.updatedAt) ?? collection.updatedAt,
  };
}
