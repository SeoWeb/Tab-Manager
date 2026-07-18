import { applyRemoteChanges, change, EMPTY } from './applyChanges.shared';
import {
  buildNotePatch,
  buildTodoPatch,
  buildTaskPatch,
} from '../../entityPatches';
import type { Note } from '@/stores/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type { CloudEntityType } from '../../types';

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
