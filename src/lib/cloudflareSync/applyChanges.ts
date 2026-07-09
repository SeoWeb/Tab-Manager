import type { Project, Collection, Link } from '@/types';
import type { Note } from '@/stores/types';
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
import type { CloudSyncChange } from './types';

/**
 * Pure reducer that folds server change-log rows into the local store shape.
 *
 * Remote changes arrive as flat `CloudSyncChange` rows; the local store is
 * nested (Project -> Collection[] -> Link[]) plus flat arrays for notes/todos/
 * tasks. This maps one onto the other, skipping changes that originated on this
 * client (the local store already reflects those, so re-applying the echo would
 * be redundant and could clobber optimistic state).
 *
 * The patch payload contract for notes/todos/tasks (the `payload` object) is
 * intentionally permissive: Phase 3 will tighten exactly which fields round-trip,
 * but this applier already maps the common fields defensively.
 */

export interface ApplyChangesInput {
  projects: Project[];
  notes: Note[];
  todos: LegacyTask[];
  tasks: AdvancedTask[];
}

export interface ApplyChangesResult extends ApplyChangesInput {
  /** Changes that mutated local state. */
  applied: number;
  /** Own echoes plus changes that referenced unknown entities. */
  skipped: number;
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

export function applyRemoteChanges(
  input: ApplyChangesInput,
  changes: CloudSyncChange[],
  clientId: string
): ApplyChangesResult {
  // Deep-clone so we never mutate the live store arrays/dates.
  const state = structuredClone(input) as ApplyChangesInput;
  let applied = 0;
  let skipped = 0;

  for (const change of changes) {
    // Skip our own echoes for update/delete operations: local state already
    // reflects them (or holds newer optimistic edits we must not clobber).
    //
    // We deliberately DO apply our own `create` echoes. A `create` is safe to
    // re-apply — the builders de-dupe by entity id, so an entity we already
    // hold is left untouched and one we are missing is materialized. Skipping a
    // create echo would permanently drop a row the server keeps, which happens
    // whenever a *different tab* (or a post-wipe reload) performs the sync
    // while sharing this client id: that tab never held the entity locally, yet
    // the echo gets skipped as "ours". See the multi-tab / local-wipe desync.
    if (
      change.client_id &&
      change.client_id === clientId &&
      change.operation !== 'create'
    ) {
      skipped += 1;
      continue;
    }

    if (applyChange(state, change)) {
      applied += 1;
    } else {
      skipped += 1;
    }
  }

  return { ...state, applied, skipped };
}

function applyChange(
  state: ApplyChangesInput,
  change: CloudSyncChange
): boolean {
  switch (change.entity_type) {
    case 'project':
      return applyProject(state, change);
    case 'collection':
      return applyCollection(state, change);
    case 'link':
      return applyLink(state, change);
    case 'note':
      return applyNote(state, change);
    case 'todo':
      return applyTodo(state, change);
    case 'task':
      return applyTask(state, change);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function applyProject(
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

function buildProject(
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

function mergeProject(
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

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

function applyCollection(
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

function buildCollection(
  id: string,
  patch: Record<string, unknown>,
  createdAt: string
): Collection {
  return {
    id,
    name: pickString([patch.name]) ?? 'Untitled',
    description: pickString([patch.description]),
    links: [],
    createdAt: parseDate(createdAt) ?? new Date(),
    updatedAt: new Date(),
    color: pickString([patch.color]),
    minimized: patch.minimized === true,
    order: pickNumber([patch.order, patch.orderIndex]),
    bookmarkFolderId: pickString([patch.bookmarkFolderId]) ?? null,
  };
}

function mergeCollection(
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
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function applyLink(state: ApplyChangesInput, change: CloudSyncChange): boolean {
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

function buildLink(
  id: string,
  patch: Record<string, unknown>,
  createdAt: string
): Link {
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
  };
}

function mergeLink(link: Link, patch: Record<string, unknown>): Link {
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
  };
}

/**
 * Sort a collection's links by their `order` field. Links render by array
 * position (not `order`), so a remote reorder or cross-collection move only
 * shows up if we reposition the array; `id` is a stable tiebreaker when two
 * links share an order (e.g. mid-batch before all sibling orders arrive).
 */
function sortLinksByOrder(collection: Collection): void {
  collection.links = [...collection.links].sort((a, b) => {
    const byOrder = (a.order ?? 0) - (b.order ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function applyNote(state: ApplyChangesInput, change: CloudSyncChange): boolean {
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

  let found = false;
  state.notes = state.notes.map((n) => {
    if (n.id !== id) return n;
    found = true;
    return mergeNote(n, patch, payload);
  });
  return found;
}

function buildNote(
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
    updatedAt: new Date(),
  };
}

function mergeNote(
  note: Note,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>
): Note {
  return {
    ...note,
    title: pickString([patch.title, payload.title]) ?? note.title,
    content:
      'content' in payload
        ? (pickString([payload.content]) ?? note.content)
        : note.content,
    color:
      'color' in payload
        ? (pickString([payload.color]) ?? note.color)
        : note.color,
    isPinned: 'isPinned' in payload ? payload.isPinned === true : note.isPinned,
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Todos (legacy)
// ---------------------------------------------------------------------------

function applyTodo(state: ApplyChangesInput, change: CloudSyncChange): boolean {
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

  let found = false;
  state.todos = state.todos.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return mergeTodo(t, patch, payload);
  });
  return found;
}

function buildTodo(
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

function mergeTodo(
  todo: LegacyTask,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>
): LegacyTask {
  return {
    ...todo,
    text: pickString([patch.title, payload.text]) ?? todo.text,
    completed:
      'completed' in payload ? payload.completed === true : todo.completed,
    category:
      'category' in payload
        ? (pickString([payload.category]) ?? todo.category)
        : todo.category,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function applyTask(state: ApplyChangesInput, change: CloudSyncChange): boolean {
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

  let found = false;
  state.tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return mergeTask(t, patch, payload);
  });
  return found;
}

function buildTask(
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
    updatedAt: now,
  };
}

function mergeTask(
  task: AdvancedTask,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>
): AdvancedTask {
  return {
    ...task,
    title: pickString([patch.title, payload.title]) ?? task.title,
    description:
      pickString([patch.description, payload.description]) ?? task.description,
    priority: pickTaskPriority(payload.priority) ?? task.priority,
    status: pickTaskStatus(payload.status) ?? task.status,
    dueDate: payloadHas(payload, 'dueDate')
      ? parseDate(payload.dueDate)
      : task.dueDate,
    scheduledDate: payloadHas(payload, 'scheduledDate')
      ? parseDate(payload.scheduledDate)
      : task.scheduledDate,
    estimatedDuration: payloadHas(payload, 'estimatedDuration')
      ? pickNumber([payload.estimatedDuration])
      : task.estimatedDuration,
    actualDuration: payloadHas(payload, 'actualDuration')
      ? pickNumber([payload.actualDuration])
      : task.actualDuration,
    category: pickString([payload.category]) ?? task.category,
    tags:
      'tags' in payload
        ? (pickStringArray([payload.tags]) ?? task.tags)
        : task.tags,
    parentTaskId: payloadHas(payload, 'parentTaskId')
      ? pickString([payload.parentTaskId])
      : task.parentTaskId,
    subtasks:
      'subtasks' in payload
        ? (pickStringArray([payload.subtasks]) ?? task.subtasks)
        : task.subtasks,
    attachments: payloadHas(payload, 'attachments')
      ? reviveAttachments(payload.attachments)
      : task.attachments,
    notes: pickString([payload.notes]) ?? task.notes,
    progress: pickNumber([payload.progress]) ?? task.progress,
    comments: payloadHas(payload, 'comments')
      ? reviveComments(payload.comments)
      : task.comments,
    activities: payloadHas(payload, 'activities')
      ? reviveActivities(payload.activities)
      : task.activities,
    isArchived: payloadHas(payload, 'isArchived')
      ? payload.isArchived === true
      : task.isArchived,
    isFavorite: payloadHas(payload, 'isFavorite')
      ? payload.isFavorite === true
      : task.isFavorite,
    customFields: payloadHas(payload, 'customFields')
      ? reviveCustomFields(payload.customFields)
      : task.customFields,
    reminders: payloadHas(payload, 'reminders')
      ? reviveReminders(payload.reminders)
      : task.reminders,
    assignee: payloadHas(payload, 'assignee')
      ? pickString([payload.assignee])
      : task.assignee,
    completedAt: payloadHas(payload, 'completedAt')
      ? parseDate(payload.completedAt)
      : task.completedAt,
    recurringPattern: payloadHas(payload, 'recurringPattern')
      ? reviveRecurringPattern(payload.recurringPattern)
      : task.recurringPattern,
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function patchOf(change: CloudSyncChange): Record<string, unknown> {
  return isRecord(change.patch) ? change.patch : {};
}

function payloadOf(patch: Record<string, unknown>): Record<string, unknown> {
  return isRecord(patch.payload) ? patch.payload : {};
}

function pickString(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

function pickNumber(candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate))
      return candidate;
  }
  return undefined;
}

function pickStringArray(candidates: unknown[]): string[] | undefined {
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

function pickTaskPriority(value: unknown): TaskPriority | undefined {
  return typeof value === 'string' &&
    (TASK_PRIORITIES as string[]).includes(value)
    ? (value as TaskPriority)
    : undefined;
}

function pickTaskStatus(value: unknown): TaskStatus | undefined {
  return typeof value === 'string' &&
    (TASK_STATUSES as string[]).includes(value)
    ? (value as TaskStatus)
    : undefined;
}

function parseDate(value: unknown): Date | undefined {
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
function payloadHas(payload: Record<string, unknown>, key: string): boolean {
  return key in payload;
}

/**
 * Revivers for the nested structures on a task. Dates arrive as ISO strings in
 * the JSON payload (the backend stores payload_json verbatim); these restore
 * them to Date instances and coerce each entry to its typed shape so the store
 * never holds a string where a Date is expected.
 */
function reviveAttachments(value: unknown): TaskAttachment[] {
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

function reviveComments(value: unknown): TaskComment[] {
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

function reviveActivities(value: unknown): TaskActivity[] {
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

function reviveReminders(value: unknown): TaskReminder[] {
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

function reviveRecurringPattern(value: unknown): RecurringPattern | undefined {
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

function reviveCustomFields(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
