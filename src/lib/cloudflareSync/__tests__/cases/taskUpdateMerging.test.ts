import { applyRemoteChanges, change, EMPTY } from './applyChanges.shared';
import { buildTaskPatch } from '../../entityPatches';
import type { AdvancedTask } from '@/types/tasks';

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

  it('clears a previously-set assignee when a remote update unassigns the task', () => {
    // This device's local state: the task is assigned to alice and has the
    // other clearable optionals set.
    const assigned: AdvancedTask = {
      ...baseTask,
      assignee: 'alice',
      scheduledDate: new Date('2026-03-31T00:00:00.000Z'),
      parentTaskId: 'parent-1',
      completedAt: new Date('2026-02-20T00:00:00.000Z'),
      recurringPattern: { type: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] },
    };

    // Another client clears those fields locally, then builds the patch the same
    // way the store does after updateTask(). The wire JSON-serializes it.
    const unassigned: AdvancedTask = {
      ...assigned,
      assignee: undefined,
      scheduledDate: undefined,
      parentTaskId: undefined,
      completedAt: undefined,
      recurringPattern: undefined,
    };
    const wirePatch = JSON.parse(JSON.stringify(buildTaskPatch(unassigned)));

    const result = applyRemoteChanges(
      { ...EMPTY, tasks: [assigned] },
      [
        change({
          operation: 'update',
          entity_type: 'task',
          entity_id: 'task-1',
          project_id: 'proj-1',
          // change.client_id is 'ext-other' (the change() default), so passing
          // 'ext-me' means this is an incoming change — not our own echo.
          patch: wirePatch,
        }),
      ],
      'ext-me'
    );

    const got = result.tasks[0];
    // Regression: before the fix, buildTaskPatch omitted these fields when
    // unset (truthy check), so mergeTask treated them as "absent → leave local
    // alone" and the clear never reached other clients. That was the
    // assign-to-unassigned cross-device sync bug.
    expect(got.assignee).toBeUndefined();
    expect(got.scheduledDate).toBeUndefined();
    expect(got.parentTaskId).toBeUndefined();
    expect(got.completedAt).toBeUndefined();
    expect(got.recurringPattern).toBeUndefined();
  });
});
