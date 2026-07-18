import type { Project } from '@/types';
import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput } from './shared';
import { patchOf, pickString, parseDate } from './shared';

export function applyProject(
  state: ApplyChangesInput,
  change: CloudSyncChange
): boolean {
  const patch = patchOf(change);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    state.projects = state.projects.filter((p) => p.id !== id);
    return true;
  }

  if (change.operation === 'create') {
    if (state.projects.some((p) => p.id === id)) return true;
    state.projects.push(
      buildProject(id, patch, change.created_at, state.projects.length)
    );
    return true;
  }

  // update
  let found = false;
  state.projects = state.projects.map((p) => {
    if (p.id !== id) return p;
    found = true;
    return mergeProject(p, patch);
  });
  return found;
}

export function buildProject(
  id: string,
  patch: Record<string, unknown>,
  createdAt: string,
  order: number
): Project {
  return {
    id,
    name: pickString([patch.name]) ?? 'Untitled',
    description: pickString([patch.description]) ?? '',
    color: pickString([patch.color]) ?? '#CCCCCC',
    icon: pickString([patch.icon]) ?? '',
    collections: [],
    createdAt: parseDate(createdAt) ?? new Date(),
    updatedAt: new Date(),
    order,
    bookmarkFolderId: null,
    // Any project materialized from the change log has a server-side
    // counterpart, so it must be cloud-enabled to keep participating in syncs
    // and to show the cloud affordances on the receiving client/device.
    cloudEnabled: true,
  };
}

export function mergeProject(
  project: Project,
  patch: Record<string, unknown>
): Project {
  return {
    ...project,
    name: pickString([patch.name]) ?? project.name,
    description: pickString([patch.description]) ?? project.description ?? '',
    color: pickString([patch.color]) ?? project.color,
    icon: pickString([patch.icon]) ?? project.icon,
    updatedAt: new Date(),
  };
}
