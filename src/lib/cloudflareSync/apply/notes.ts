import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput, ApplyContext, Note } from './shared';
import {
  patchOf,
  payloadOf,
  pickString,
  parseDate,
} from './shared';
import { touchedFieldsOf, detectConflicts } from './conflicts';

export function applyNote(
  state: ApplyChangesInput,
  change: CloudSyncChange,
  ctx: ApplyContext
): boolean {
  const patch = patchOf(change);
  const payload = payloadOf(patch);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    state.notes = state.notes.filter((n) => n.id !== id);
    return true;
  }

  if (change.operation === 'create') {
    if (state.notes.some((n) => n.id === id)) return true;
    state.notes.push(
      buildNote(id, patch, payload, change.created_at, change.project_id)
    );
    return true;
  }

  const existing = state.notes.find((n) => n.id === id);
  if (!existing) return false;
  const skip = detectConflicts({
    entityType: 'note',
    entityId: id,
    projectId: change.project_id,
    current: existing as unknown as Record<string, unknown>,
    touched: touchedFieldsOf(patch, payload),
    ctx,
    changeId: change.id,
  });

  state.notes = state.notes.map((n) =>
    n.id === id ? mergeNote(n, patch, payload, skip) : n
  );
  return true;
}

export function buildNote(
  id: string,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  createdAt: string,
  projectId?: string
): Note {
  return {
    id,
    title: pickString([patch.title, payload.title]) ?? 'Untitled',
    content: pickString([payload.content]) ?? '',
    color: pickString([payload.color]) ?? '#ffffff',
    isPinned: payload.isPinned === true,
    // Project is authoritative from the change row (Phase B2); fall back to a
    // patch-supplied value for older payloads. projectId is immutable once set.
    projectId: pickString([projectId, patch.projectId]),
    createdAt: parseDate(createdAt) ?? new Date(),
    // Reconcile pulls carry the server `updated_at` so the local note keeps it;
    // the incremental sync path leaves it absent and falls back to "now".
    updatedAt: parseDate(patch.updated_at ?? patch.updatedAt) ?? new Date(),
  };
}

export function mergeNote(
  note: Note,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  skip?: Set<string>
): Note {
  return {
    ...note,
    title: skip?.has('title')
      ? note.title
      : (pickString([patch.title, payload.title]) ?? note.title),
    content: skip?.has('content')
      ? note.content
      : 'content' in payload
        ? (pickString([payload.content]) ?? note.content)
        : note.content,
    color: skip?.has('color')
      ? note.color
      : 'color' in payload
        ? (pickString([payload.color]) ?? note.color)
        : note.color,
    isPinned: skip?.has('isPinned')
      ? note.isPinned
      : 'isPinned' in payload
        ? payload.isPinned === true
        : note.isPinned,
    // Reconcile pulls preserve the server `updated_at`; local updates leave it.
    updatedAt: parseDate(patch.updated_at ?? patch.updatedAt) ?? note.updatedAt,
  };
}
