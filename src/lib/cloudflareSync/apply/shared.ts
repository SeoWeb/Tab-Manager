import type { Project } from '@/types';
import type {
  AdvancedTask,
  LegacyTask,
  TaskPriority,
  TaskStatus,
  TaskAttachment,
  TaskComment,
  TaskActivity,
  TaskReminder,
  RecurringPattern,
} from '@/types/tasks';
import type { Note } from '@/stores/types';
import type { CloudSyncChange, DirtyFields, SyncConflictItem } from '../types';

export interface ApplyChangesInput {
  projects: Project[];
  notes: Note[];
  todos: LegacyTask[];
  tasks: AdvancedTask[];
}

/**
 * Context threaded through the applier so it can detect (and avoid) silently
 * dropping local edits that have not yet been pushed to the server.
 */
export interface ApplyContext {
  dirtyFields: DirtyFields;
  conflicts: SyncConflictItem[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function patchOf(change: CloudSyncChange): Record<string, unknown> {
  return isRecord(change.patch) ? change.patch : {};
}

export function payloadOf(
  patch: Record<string, unknown>
): Record<string, unknown> {
  return isRecord(patch.payload) ? patch.payload : {};
}

export function pickString(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

export function pickNumber(candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate))
      return candidate;
  }
  return undefined;
}

export function pickStringArray(candidates: unknown[]): string[] | undefined {
  for (const candidate of candidates) {
    if (
      Array.isArray(candidate) &&
      candidate.every((item) => typeof item === 'string')
    ) {
      return candidate;
    }
  }
  return undefined;
}

const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES: TaskStatus[] = [
  'todo',
  'in-progress',
  'blocked',
  'completed',
  'cancelled',
  'archived',
];

export function pickTaskPriority(value: unknown): TaskPriority | undefined {
  return typeof value === 'string' &&
    (TASK_PRIORITIES as string[]).includes(value)
    ? (value as TaskPriority)
    : undefined;
}

export function pickTaskStatus(value: unknown): TaskStatus | undefined {
  return typeof value === 'string' &&
    (TASK_STATUSES as string[]).includes(value)
    ? (value as TaskStatus)
    : undefined;
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * True when the payload explicitly carries `key`. Used to distinguish "field
 * absent" (leave the local value alone) from "field present" (apply it) when
 * merging a remote update — dates and optional fields are omitted from the
 * patch when unset, so presence is what matters.
 */
export function payloadHas(
  payload: Record<string, unknown>,
  key: string
): boolean {
  return key in payload;
}

/**
 * Revivers for the nested structures on a task. Dates arrive as ISO strings in
 * the JSON payload (the backend stores payload_json verbatim); these restore
 * them to Date instances and coerce each entry to its typed shape so the store
 * never holds a string where a Date is expected.
 */
export function reviveAttachments(value: unknown): TaskAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((a) => {
    const attachment: TaskAttachment = {
      id: pickString([a.id]) ?? crypto.randomUUID(),
      name: pickString([a.name]) ?? '',
      url: pickString([a.url]) ?? '',
      type: (pickString([a.type]) ?? 'link') as TaskAttachment['type'],
      createdAt: parseDate(a.createdAt) ?? new Date(),
    };
    const size = pickNumber([a.size]);
    if (size !== undefined) attachment.size = size;
    return attachment;
  });
}

export function reviveComments(value: unknown): TaskComment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((c) => {
    const comment: TaskComment = {
      id: pickString([c.id]) ?? crypto.randomUUID(),
      content: pickString([c.content]) ?? '',
      author: pickString([c.author]) ?? '',
      createdAt: parseDate(c.createdAt) ?? new Date(),
    };
    const updatedAt = parseDate(c.updatedAt);
    if (updatedAt) comment.updatedAt = updatedAt;
    return comment;
  });
}

export function reviveActivities(value: unknown): TaskActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((act) => {
    const activity: TaskActivity = {
      id: pickString([act.id]) ?? crypto.randomUUID(),
      type: (pickString([act.type]) ?? 'updated') as TaskActivity['type'],
      description: pickString([act.description]) ?? '',
      author: pickString([act.author]) ?? '',
      timestamp: parseDate(act.timestamp) ?? new Date(),
    };
    if (isRecord(act.metadata)) activity.metadata = act.metadata;
    return activity;
  });
}

export function reviveReminders(value: unknown): TaskReminder[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((r) => {
    const reminder: TaskReminder = {
      id: pickString([r.id]) ?? crypto.randomUUID(),
      type: (pickString([r.type]) ?? 'notification') as TaskReminder['type'],
      triggerBefore: pickNumber([r.triggerBefore]) ?? 0,
      isActive: r.isActive === true,
    };
    const message = pickString([r.message]);
    if (message) reminder.message = message;
    return reminder;
  });
}

export function reviveRecurringPattern(
  value: unknown
): RecurringPattern | undefined {
  if (!isRecord(value)) return undefined;
  const type = pickString([value.type]) as RecurringPattern['type'] | undefined;
  if (!type) return undefined;
  const pattern: RecurringPattern = {
    type,
    interval: pickNumber([value.interval]) ?? 1,
  };
  if (Array.isArray(value.daysOfWeek)) {
    pattern.daysOfWeek = value.daysOfWeek.filter(
      (d): d is number => typeof d === 'number'
    );
  }
  const endDate = parseDate(value.endDate);
  if (endDate) pattern.endDate = endDate;
  const maxOccurrences = pickNumber([value.maxOccurrences]);
  if (maxOccurrences !== undefined) pattern.maxOccurrences = maxOccurrences;
  return pattern;
}

export function reviveCustomFields(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export type { Note, AdvancedTask, LegacyTask };
