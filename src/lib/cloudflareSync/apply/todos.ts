import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput, ApplyContext, LegacyTask } from './shared';
import { patchOf, payloadOf, pickString } from './shared';
import { touchedFieldsOf, detectConflicts } from './conflicts';

export function applyTodo(
  state: ApplyChangesInput,
  change: CloudSyncChange,
  ctx: ApplyContext
): boolean {
  const patch = patchOf(change);
  const payload = payloadOf(patch);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    state.todos = state.todos.filter((t) => t.id !== id);
    return true;
  }

  if (change.operation === 'create') {
    if (state.todos.some((t) => t.id === id)) return true;
    state.todos.push(buildTodo(id, patch, payload, change.project_id));
    return true;
  }

  const existing = state.todos.find((t) => t.id === id);
  if (!existing) return false;
  const skip = detectConflicts({
    entityType: 'todo',
    entityId: id,
    projectId: change.project_id,
    current: existing as unknown as Record<string, unknown>,
    touched: touchedFieldsOf(patch, payload),
    ctx,
    changeId: change.id,
  });

  state.todos = state.todos.map((t) =>
    t.id === id ? mergeTodo(t, patch, payload, skip) : t
  );
  return true;
}

export function buildTodo(
  id: string,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  projectId?: string
): LegacyTask {
  return {
    id,
    text: pickString([patch.title, payload.text]) ?? '',
    completed: payload.completed === true,
    category: pickString([payload.category, patch.collectionId]),
    // Project is authoritative from the change row (Phase B2); projectId is
    // immutable once set.
    projectId: pickString([projectId, patch.projectId]),
  };
}

export function mergeTodo(
  todo: LegacyTask,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  skip?: Set<string>
): LegacyTask {
  return {
    ...todo,
    text: skip?.has('text')
      ? todo.text
      : (pickString([patch.title, payload.text]) ?? todo.text),
    completed: skip?.has('completed')
      ? todo.completed
      : 'completed' in payload
        ? payload.completed === true
        : todo.completed,
    category: skip?.has('category')
      ? todo.category
      : 'category' in payload
        ? (pickString([payload.category]) ?? todo.category)
        : todo.category,
  };
}
