import { applyRemoteChanges } from '../applyChanges';
import {
  buildNotePatch,
  buildTodoPatch,
  buildTaskPatch,
} from '../entityPatches';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type { Note } from '@/stores/types';
import type { CloudEntityType, CloudSyncChange } from '../types';

/** Build a change-log row with sane defaults, overridden per test. */
function change(
  overrides: Partial<CloudSyncChange> &
    Pick<CloudSyncChange, 'entity_type' | 'entity_id' | 'project_id' | 'patch'>
): CloudSyncChange {
  return {
    id: 1,
    change_id: 'ch-1',
    actor_id: 'u-other',
    operation: 'create',
    base_version: null,
    client_mutation_id: null,
    client_id: 'ext-other',
    created_at: '2026-06-16T12:00:00.000Z',
    ...overrides,
  };
}

const EMPTY = { projects: [], notes: [], todos: [], tasks: [] };

describe('applyRemoteChanges — projectId stamping (Phase B2)', () => {
  it('stamps projectId from change.project_id on a created note', () => {
    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          patch: {
            title: 'My note',
            payload: { content: 'hello', color: '#fff', isPinned: true },
          },
        }),
      ],
      'ext-me'
    );

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({
      id: 'note-1',
      projectId: 'proj-1',
      title: 'My note',
      content: 'hello',
      color: '#fff',
      isPinned: true,
    });
  });

  it('stamps projectId from change.project_id on a created todo', () => {
    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'todo',
          entity_id: 'todo-1',
          project_id: 'proj-1',
          patch: {
            title: 'Buy milk',
            payload: {
              text: 'Buy milk',
              completed: true,
              category: 'groceries',
            },
          },
        }),
      ],
      'ext-me'
    );

    expect(result.todos).toHaveLength(1);
    expect(result.todos[0]).toMatchObject({
      id: 'todo-1',
      projectId: 'proj-1',
      text: 'Buy milk',
      completed: true,
      category: 'groceries',
    });
  });

  it('stamps projectId from change.project_id on a created task', () => {
    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'task',
          entity_id: 'task-1',
          project_id: 'proj-1',
          // Even if the patch carries a different/stale projectId, the change
          // row's project_id wins.
          patch: {
            title: 'Ship it',
            projectId: 'stale-proj',
            payload: {
              title: 'Ship it',
              description: null,
              priority: 'high',
              status: 'in-progress',
              category: 'eng',
              tags: ['x'],
              notes: '',
              progress: 40,
            },
          },
        }),
      ],
      'ext-me'
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      id: 'task-1',
      projectId: 'proj-1', // change.project_id wins over patch.projectId
      title: 'Ship it',
      priority: 'high',
      status: 'in-progress',
      progress: 40,
    });
  });

  it('skips our own echoes so optimistic local state is preserved', () => {
    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          client_id: 'ext-me', // echoed from this client
          patch: { title: 'echo', payload: {} },
        }),
      ],
      'ext-me'
    );

    expect(result.notes).toHaveLength(0);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('leaves projectId immutable across a note update', () => {
    const existing: Note = {
      id: 'note-1',
      title: 'Old',
      content: 'old',
      color: '#fff',
      isPinned: false,
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const result = applyRemoteChanges(
      { ...EMPTY, notes: [existing] },
      [
        change({
          operation: 'update',
          entity_type: 'note',
          entity_id: 'note-1',
          // An update row never carries a project move; projectId stays put.
          project_id: 'proj-1',
          patch: { payload: { content: 'new content' } },
        }),
      ],
      'ext-me'
    );

    expect(result.notes[0].content).toBe('new content');
    expect(result.notes[0].projectId).toBe('proj-1');
  });
});

describe('applyRemoteChanges — round-trips the entity patch builders', () => {
  it('reconstructs a note from buildNotePatch', () => {
    const original: Note = {
      id: 'note-1',
      title: 'Plan',
      content: 'do the thing',
      color: '#abc',
      isPinned: true,
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          patch: buildNotePatch(original),
        }),
      ],
      'ext-me'
    );

    const got = result.notes[0];
    expect(got.title).toBe(original.title);
    expect(got.content).toBe(original.content);
    expect(got.color).toBe(original.color);
    expect(got.isPinned).toBe(original.isPinned);
    expect(got.projectId).toBe(original.projectId);
  });

  it('reconstructs a todo from buildTodoPatch', () => {
    const original: LegacyTask = {
      id: 'todo-1',
      text: 'Walk dog',
      completed: false,
      category: 'home',
      projectId: 'proj-1',
    };

    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'todo',
          entity_id: 'todo-1',
          project_id: 'proj-1',
          patch: buildTodoPatch(original),
        }),
      ],
      'ext-me'
    );

    const got = result.todos[0];
    expect(got.text).toBe(original.text);
    expect(got.completed).toBe(original.completed);
    expect(got.category).toBe(original.category);
    expect(got.projectId).toBe(original.projectId);
  });

  it('reconstructs a task from buildTaskPatch across the wire (dates revived)', () => {
    const original: AdvancedTask = {
      id: 'task-1',
      title: 'Write tests',
      description: 'cover sync',
      priority: 'urgent',
      status: 'blocked',
      category: 'qa',
      tags: ['phase-b'],
      projectId: 'proj-1',
      collectionId: 'col-1',
      dueDate: new Date('2026-03-01T09:00:00.000Z'),
      scheduledDate: new Date('2026-02-28T09:00:00.000Z'),
      estimatedDuration: 90,
      actualDuration: 45,
      assignee: 'alice',
      parentTaskId: 'parent-1',
      subtasks: ['s-1', 's-2'],
      attachments: [
        {
          id: 'a-1',
          name: 'spec',
          url: 'https://x/spec',
          type: 'link',
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        },
      ],
      notes: 'see spec',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      completedAt: new Date('2026-02-20T00:00:00.000Z'),
      recurringPattern: { type: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] },
      progress: 25,
      comments: [
        {
          id: 'c-1',
          content: 'nice',
          author: 'bob',
          createdAt: new Date('2026-01-10T00:00:00.000Z'),
        },
      ],
      activities: [
        {
          id: 'ac-1',
          type: 'created',
          description: 'created',
          author: 'alice',
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      isArchived: false,
      isFavorite: true,
      customFields: { team: 'sync' },
      reminders: [
        {
          id: 'r-1',
          type: 'notification',
          triggerBefore: 15,
          isActive: true,
        },
      ],
    };

    // Simulate the wire: the patch is JSON-serialized on enqueue and on the way
    // back, so Dates arrive as ISO strings the applier must revive.
    const wirePatch = JSON.parse(JSON.stringify(buildTaskPatch(original)));

    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'task',
          entity_id: 'task-1',
          project_id: 'proj-1',
          patch: wirePatch,
        }),
      ],
      'ext-me'
    );

    const got = result.tasks[0];
    expect(got).toMatchObject({
      title: original.title,
      description: original.description,
      priority: original.priority,
      status: original.status,
      category: original.category,
      tags: original.tags,
      notes: original.notes,
      progress: original.progress,
      projectId: original.projectId,
      collectionId: original.collectionId,
      estimatedDuration: 90,
      actualDuration: 45,
      assignee: 'alice',
      parentTaskId: 'parent-1',
      subtasks: ['s-1', 's-2'],
      isArchived: false,
      isFavorite: true,
      customFields: { team: 'sync' },
    });
    // Dates were revived from ISO strings (not left as strings).
    expect(got.dueDate).toBeInstanceOf(Date);
    expect(got.dueDate).toEqual(original.dueDate);
    expect(got.scheduledDate).toEqual(original.scheduledDate);
    expect(got.completedAt).toEqual(original.completedAt);
    // Nested dates revived too.
    expect(got.attachments[0].createdAt).toEqual(
      original.attachments[0].createdAt
    );
    expect(got.comments[0].createdAt).toEqual(original.comments[0].createdAt);
    expect(got.activities[0].timestamp).toEqual(
      original.activities[0].timestamp
    );
    // Nested non-date structures round-trip.
    expect(got.reminders[0]).toMatchObject({
      id: 'r-1',
      triggerBefore: 15,
      isActive: true,
    });
    expect(got.recurringPattern).toEqual({
      type: 'weekly',
      interval: 1,
      daysOfWeek: [1, 3, 5],
    });
  });

  it('ignores unknown entity types', () => {
    const result = applyRemoteChanges(
      EMPTY,
      [
        change({
          entity_type: 'widget' as unknown as CloudEntityType,
          entity_id: 'x',
          project_id: 'proj-1',
          patch: {},
        }),
      ],
      'ext-me'
    );

    expect(result.applied).toBe(0);
  });
});

describe('applyRemoteChanges — task update merging', () => {
  const baseTask: AdvancedTask = {
    id: 'task-1',
    title: 'Original',
    description: 'desc',
    priority: 'high',
    status: 'todo',
    category: 'eng',
    tags: ['keep'],
    projectId: 'proj-1',
    dueDate: new Date('2026-04-01T00:00:00.000Z'),
    subtasks: ['s-1'],
    attachments: [],
    notes: 'notes',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    progress: 10,
    comments: [],
    activities: [],
    isArchived: false,
    isFavorite: true,
    customFields: { k: 'v' },
    reminders: [],
  };

  it('applies the patched fields and preserves fields the patch omits', () => {
    const result = applyRemoteChanges(
      { ...EMPTY, tasks: [baseTask] },
      [
        change({
          operation: 'update',
          entity_type: 'task',
          entity_id: 'task-1',
          project_id: 'proj-1',
          patch: {
            title: 'Renamed',
            payload: {
              status: 'completed',
              completedAt: '2026-02-20T00:00:00.000Z',
            },
          },
        }),
      ],
      'ext-me'
    );

    const got = result.tasks[0];
    // Patched fields applied.
    expect(got.title).toBe('Renamed');
    expect(got.status).toBe('completed');
    expect(got.completedAt).toEqual(new Date('2026-02-20T00:00:00.000Z'));
    // Omitted fields preserved (not clobbered to defaults).
    expect(got.priority).toBe('high');
    expect(got.tags).toEqual(['keep']);
    // jsdom's structuredClone stringifies Dates, so compare by ISO value rather
    // than identity — the point is the omitted field is preserved, not reset.
    // (The non-null assertions are safe: baseTask sets dueDate, and a dropped
    // field would make new Date(undefined).toISOString() throw, failing here.)
    expect(new Date(got.dueDate!).toISOString()).toBe(
      baseTask.dueDate!.toISOString()
    );
    expect(got.subtasks).toEqual(['s-1']);
    expect(got.isFavorite).toBe(true);
    expect(got.customFields).toEqual({ k: 'v' });
  });

  it('keeps projectId immutable across an update', () => {
    const result = applyRemoteChanges(
      { ...EMPTY, tasks: [baseTask] },
      [
        change({
          operation: 'update',
          entity_type: 'task',
          entity_id: 'task-1',
          // The change row is filed under the task's project; an update never
          // moves the task on its own (moves fan out as create+delete).
          project_id: 'proj-1',
          patch: { payload: { progress: 50 } },
        }),
      ],
      'ext-me'
    );

    expect(result.tasks[0].projectId).toBe('proj-1');
    expect(result.tasks[0].progress).toBe(50);
  });
});
