import type { CloudSyncChange } from '../types';
import type { ApplyChangesInput, ApplyContext, AdvancedTask } from './shared';
import {
  patchOf,
  payloadOf,
  pickString,
  pickNumber,
  pickStringArray,
  parseDate,
  pickTaskPriority,
  pickTaskStatus,
  payloadHas,
  reviveAttachments,
  reviveComments,
  reviveActivities,
  reviveReminders,
  reviveRecurringPattern,
  reviveCustomFields,
} from './shared';
import { touchedFieldsOf, detectConflicts } from './conflicts';

export function applyTask(
  state: ApplyChangesInput,
  change: CloudSyncChange,
  ctx: ApplyContext
): boolean {
  const patch = patchOf(change);
  const payload = payloadOf(patch);
  const id = change.entity_id;

  if (change.operation === 'delete') {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    return true;
  }

  if (change.operation === 'create') {
    if (state.tasks.some((t) => t.id === id)) return true;
    state.tasks.push(
      buildTask(id, patch, payload, change.created_at, change.project_id)
    );
    return true;
  }

  const existing = state.tasks.find((t) => t.id === id);
  if (!existing) return false;
  const skip = detectConflicts({
    entityType: 'task',
    entityId: id,
    projectId: change.project_id,
    current: existing as unknown as Record<string, unknown>,
    touched: touchedFieldsOf(patch, payload),
    ctx,
    changeId: change.id,
  });

  state.tasks = state.tasks.map((t) =>
    t.id === id ? mergeTask(t, patch, payload, skip) : t
  );
  return true;
}

export function buildTask(
  id: string,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  createdAt: string,
  projectId?: string
): AdvancedTask {
  const now = new Date();
  // Respect the payload's activity log when present (even if empty); only
  // synthesize a "created via cloud sync" entry when the sender omitted it.
  const restoredActivities = Array.isArray(payload.activities)
    ? reviveActivities(payload.activities)
    : null;
  return {
    id,
    title: pickString([patch.title, payload.title]) ?? 'Untitled',
    description: pickString([patch.description, payload.description]),
    priority: pickTaskPriority(payload.priority) ?? 'medium',
    status: pickTaskStatus(payload.status) ?? 'todo',
    dueDate: parseDate(payload.dueDate),
    scheduledDate: parseDate(payload.scheduledDate),
    estimatedDuration: pickNumber([payload.estimatedDuration]),
    actualDuration: pickNumber([payload.actualDuration]),
    category: pickString([payload.category, patch.collectionId]) ?? 'general',
    tags: pickStringArray([payload.tags]) ?? [],
    // Project is authoritative from the change row (Phase B2), then any value
    // carried in the patch/payload. projectId is immutable once set.
    projectId: pickString([projectId, patch.projectId, payload.projectId]),
    collectionId: pickString([patch.collectionId, payload.collectionId]),
    parentTaskId: pickString([payload.parentTaskId]),
    subtasks: pickStringArray([payload.subtasks]) ?? [],
    attachments: reviveAttachments(payload.attachments),
    notes: pickString([payload.notes]) ?? '',
    progress: pickNumber([payload.progress]) ?? 0,
    comments: reviveComments(payload.comments),
    activities: restoredActivities ?? [
      {
        id: crypto.randomUUID(),
        type: 'created',
        description: 'Task created via cloud sync',
        author: 'sync',
        timestamp: now,
      },
    ],
    isArchived: payload.isArchived === true,
    isFavorite: payload.isFavorite === true,
    customFields: reviveCustomFields(payload.customFields),
    reminders: reviveReminders(payload.reminders),
    assignee: pickString([payload.assignee]),
    completedAt: parseDate(payload.completedAt),
    recurringPattern: reviveRecurringPattern(payload.recurringPattern),
    createdAt: parseDate(createdAt) ?? now,
    // Reconcile pulls carry the server `updated_at` so the local task keeps it;
    // the incremental sync path leaves it absent and falls back to "now".
    updatedAt: parseDate(patch.updated_at ?? patch.updatedAt) ?? now,
  };
}

export function mergeTask(
  task: AdvancedTask,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  skip?: Set<string>
): AdvancedTask {
  return {
    ...task,
    title: skip?.has('title')
      ? task.title
      : (pickString([patch.title, payload.title]) ?? task.title),
    description: skip?.has('description')
      ? task.description
      : (pickString([patch.description, payload.description]) ??
        task.description),
    priority: skip?.has('priority')
      ? task.priority
      : (pickTaskPriority(payload.priority) ?? task.priority),
    status: skip?.has('status')
      ? task.status
      : (pickTaskStatus(payload.status) ?? task.status),
    dueDate: skip?.has('dueDate')
      ? task.dueDate
      : payloadHas(payload, 'dueDate')
        ? parseDate(payload.dueDate)
        : task.dueDate,
    scheduledDate: skip?.has('scheduledDate')
      ? task.scheduledDate
      : payloadHas(payload, 'scheduledDate')
        ? parseDate(payload.scheduledDate)
        : task.scheduledDate,
    estimatedDuration: skip?.has('estimatedDuration')
      ? task.estimatedDuration
      : payloadHas(payload, 'estimatedDuration')
        ? pickNumber([payload.estimatedDuration])
        : task.estimatedDuration,
    actualDuration: skip?.has('actualDuration')
      ? task.actualDuration
      : payloadHas(payload, 'actualDuration')
        ? pickNumber([payload.actualDuration])
        : task.actualDuration,
    category: skip?.has('category')
      ? task.category
      : (pickString([payload.category]) ?? task.category),
    tags: skip?.has('tags')
      ? task.tags
      : 'tags' in payload
        ? (pickStringArray([payload.tags]) ?? task.tags)
        : task.tags,
    parentTaskId: skip?.has('parentTaskId')
      ? task.parentTaskId
      : payloadHas(payload, 'parentTaskId')
        ? pickString([payload.parentTaskId])
        : task.parentTaskId,
    subtasks: skip?.has('subtasks')
      ? task.subtasks
      : 'subtasks' in payload
        ? (pickStringArray([payload.subtasks]) ?? task.subtasks)
        : task.subtasks,
    attachments: skip?.has('attachments')
      ? task.attachments
      : payloadHas(payload, 'attachments')
        ? reviveAttachments(payload.attachments)
        : task.attachments,
    notes: skip?.has('notes')
      ? task.notes
      : (pickString([payload.notes]) ?? task.notes),
    progress: skip?.has('progress')
      ? task.progress
      : (pickNumber([payload.progress]) ?? task.progress),
    comments: skip?.has('comments')
      ? task.comments
      : payloadHas(payload, 'comments')
        ? reviveComments(payload.comments)
        : task.comments,
    activities: skip?.has('activities')
      ? task.activities
      : payloadHas(payload, 'activities')
        ? reviveActivities(payload.activities)
        : task.activities,
    isArchived: skip?.has('isArchived')
      ? task.isArchived
      : payloadHas(payload, 'isArchived')
        ? payload.isArchived === true
        : task.isArchived,
    isFavorite: skip?.has('isFavorite')
      ? task.isFavorite
      : payloadHas(payload, 'isFavorite')
        ? payload.isFavorite === true
        : task.isFavorite,
    customFields: skip?.has('customFields')
      ? task.customFields
      : payloadHas(payload, 'customFields')
        ? reviveCustomFields(payload.customFields)
        : task.customFields,
    reminders: skip?.has('reminders')
      ? task.reminders
      : payloadHas(payload, 'reminders')
        ? reviveReminders(payload.reminders)
        : task.reminders,
    assignee: skip?.has('assignee')
      ? task.assignee
      : payloadHas(payload, 'assignee')
        ? pickString([payload.assignee])
        : task.assignee,
    completedAt: skip?.has('completedAt')
      ? task.completedAt
      : payloadHas(payload, 'completedAt')
        ? parseDate(payload.completedAt)
        : task.completedAt,
    recurringPattern: skip?.has('recurringPattern')
      ? task.recurringPattern
      : payloadHas(payload, 'recurringPattern')
        ? reviveRecurringPattern(payload.recurringPattern)
        : task.recurringPattern,
    // Reconcile pulls preserve the server `updated_at`; local updates leave it.
    updatedAt: parseDate(patch.updated_at ?? patch.updatedAt) ?? task.updatedAt,
  };
}
