import type { Note } from '@/stores/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';

/**
 * Patch builders for the JSON-backed entities (note/todo/task).
 *
 * The backend stores these entities as a `title` column plus a `payload_json`
 * blob (see `prepareInsertJsonEntity` / `prepareUpdateJsonEntity` in
 * `backend/src/lib/sync.ts`), and `applyChanges.ts` reads that same shape back
 * when folding remote change-log rows into the store. These builders produce
 * exactly that wire shape: `{ title, payload: { ... } }`.
 *
 * The SAME builder is used for both `create` and `update` mutations. This is
 * deliberate: the backend replaces `payload_json` *wholesale* on update, so a
 * partial payload would wipe the entity's other fields server-side and then
 * propagate that loss to every other client on the next sync. Sending the full
 * payload on every write is the only correct choice, so callers always read the
 * materialized entity from the store after the optimistic `set` and pass it
 * here.
 *
 * `projectId` is intentionally NOT placed in the patch: the `project_id` column
 * is bound from the mutation's `projectId` field, and `applyChanges` stamps it
 * from the change row's `project_id` (Phase B2). `collectionId` is included for
 * tasks (the backend binds it to a column; notes/todos leave it unset).
 */

export function buildNotePatch(note: Note): Record<string, unknown> {
  return {
    title: note.title,
    payload: {
      content: note.content,
      color: note.color,
      isPinned: note.isPinned,
    },
  };
}

export function buildTodoPatch(todo: LegacyTask): Record<string, unknown> {
  return {
    title: todo.text,
    payload: {
      text: todo.text,
      completed: todo.completed,
      category: todo.category ?? null,
    },
  };
}

export function buildTaskPatch(task: AdvancedTask): Record<string, unknown> {
  // The required AdvancedTask fields are always sent so a remote create or a
  // full-payload update reconstructs the whole task (the backend replaces
  // payload_json wholesale on update, so omitting a field would erase it).
  const payload: Record<string, unknown> = {
    title: task.title,
    description: task.description ?? null,
    priority: task.priority,
    status: task.status,
    category: task.category,
    tags: task.tags,
    notes: task.notes,
    progress: task.progress,
    subtasks: task.subtasks,
    attachments: task.attachments,
    comments: task.comments,
    activities: task.activities,
    reminders: task.reminders,
    isArchived: task.isArchived,
    isFavorite: task.isFavorite,
    customFields: task.customFields,
  };
  // Optional fields are included only when set, so they round-trip without
  // polluting the payload (and without overriding a real value with null).
  if (task.dueDate) payload.dueDate = task.dueDate;
  if (task.scheduledDate) payload.scheduledDate = task.scheduledDate;
  if (task.estimatedDuration !== undefined)
    payload.estimatedDuration = task.estimatedDuration;
  if (task.actualDuration !== undefined)
    payload.actualDuration = task.actualDuration;
  if (task.assignee) payload.assignee = task.assignee;
  if (task.parentTaskId) payload.parentTaskId = task.parentTaskId;
  if (task.completedAt) payload.completedAt = task.completedAt;
  if (task.recurringPattern) payload.recurringPattern = task.recurringPattern;

  const patch: Record<string, unknown> = { title: task.title, payload };
  if (task.collectionId) patch.collectionId = task.collectionId;
  return patch;
}
