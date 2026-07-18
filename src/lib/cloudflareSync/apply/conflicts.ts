import type { CloudSyncChange } from '../types';
import type { ApplyContext } from './shared';

/**
 * Conflict detection (field-level, dirty-aware)
 *
 * When a remote change arrives for a field the local client has a *pending,
 * not-yet-pushed* edit for, applying it would silently drop the user's in-flight
 * work (last-write-wins). Instead we keep the local value and record a conflict
 * so the UI can offer local / remote / merge. Fields without a pending local
 * edit merge normally (true field-level merge), preserving unrelated edits.
 */

/** Fields a remote change would write: top-level `title` plus every payload key. */
export function touchedFieldsOf(
  patch: Record<string, unknown>,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('title' in patch) out.title = patch.title;
  for (const k of Object.keys(payload)) out[k] = payload[k];
  return out;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = a instanceof Date ? a.toISOString() : a;
  const nb = b instanceof Date ? b.toISOString() : b;
  if (na === nb) return true;
  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

/**
 * Compare a remote change's touched fields against the local entity + the local
 * dirty set. Returns the set of fields to SKIP (keep local) and records a
 * conflict for each, so the local in-flight edit is never silently overwritten.
 */
export function detectConflicts(params: {
  entityType: CloudSyncChange['entity_type'];
  entityId: string;
  projectId: string;
  current: Record<string, unknown>;
  touched: Record<string, unknown>;
  ctx: ApplyContext;
  changeId: number;
}): Set<string> {
  const { entityType, entityId, projectId, current, touched, ctx, changeId } =
    params;
  const dirty = ctx.dirtyFields[entityId];
  const skip = new Set<string>();
  if (!dirty || dirty.length === 0) return skip;

  for (const [field, remoteValue] of Object.entries(touched)) {
    if (!dirty.includes(field)) continue;
    const localValue = current[field];
    if (valuesEqual(localValue, remoteValue)) continue;
    skip.add(field);
    ctx.conflicts.push({
      id: `${entityId}:${field}:${changeId}`,
      entityType,
      entityId,
      field,
      localValue,
      remoteValue,
      projectId,
      createdAt: new Date().toISOString(),
    });
  }
  return skip;
}
