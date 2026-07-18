import {
  mockedEnqueue,
  makeStore,
  PROJECT,
  lastCall,
  createTaskActions,
} from './entitySyncActions.shared';
import type { AdvancedTask } from './entitySyncActions.shared';

describe('taskActions cloud sync', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  /** A minimal valid addTask() input (Omit<AdvancedTask, id|createdAt|updatedAt|activities>). */
  function taskInput(
    overrides: Partial<AdvancedTask> = {}
  ): Omit<AdvancedTask, 'id' | 'createdAt' | 'updatedAt' | 'activities'> {
    return {
      title: 'Ship it',
      priority: 'high',
      status: 'todo',
      category: 'eng',
      tags: [],
      subtasks: [],
      attachments: [],
      notes: '',
      progress: 0,
      comments: [],
      isArchived: false,
      isFavorite: false,
      customFields: {},
      reminders: [],
      ...overrides,
    };
  }

  it('enqueues a create with the task payload shape on addTask', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [],
    });
    const actions = createTaskActions(set, get);

    const id = actions.addTask(taskInput({ collectionId: 'col-1' }));

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      projectId: 'proj-1',
      entityType: 'task',
      entityId: id,
      operation: 'create',
      patch: {
        title: 'Ship it',
        collectionId: 'col-1',
        payload: {
          title: 'Ship it',
          description: null,
          priority: 'high',
          status: 'todo',
          category: 'eng',
          tags: [],
          notes: '',
          progress: 0,
          subtasks: [],
          attachments: [],
          comments: [],
          reminders: [],
          isArchived: false,
          isFavorite: false,
          customFields: {},
          // Clearable optionals are always present (null when unset) so clearing
          // them round-trips to other clients (see applyChanges.test.ts).
          dueDate: null,
          scheduledDate: null,
          assignee: null,
          parentTaskId: null,
          completedAt: null,
          recurringPattern: null,
          activities: [
            {
              id: expect.any(String),
              type: 'created',
              description: 'Task created',
              author: 'user',
              timestamp: expect.any(Date),
            },
          ],
        },
      },
    });
    expect(get().tasks[0]).toMatchObject({
      id,
      projectId: 'proj-1',
      collectionId: 'col-1',
    });
  });

  it('enqueues an update carrying the full current payload', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [
        {
          id: 'task-1',
          title: 'Old',
          description: 'd',
          priority: 'low',
          status: 'todo',
          category: 'eng',
          tags: [],
          subtasks: [],
          attachments: [],
          notes: '',
          progress: 0,
          comments: [],
          activities: [],
          isArchived: false,
          isFavorite: false,
          customFields: {},
          reminders: [],
          projectId: 'proj-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    const actions = createTaskActions(set, get);

    actions.updateTask('task-1', { status: 'completed', progress: 100 });

    expect(lastCall()).toEqual({
      projectId: 'proj-1',
      entityType: 'task',
      entityId: 'task-1',
      operation: 'update',
      patch: {
        title: 'Old',
        payload: {
          title: 'Old',
          description: 'd',
          priority: 'low',
          status: 'completed',
          category: 'eng',
          tags: [],
          notes: '',
          progress: 100,
          subtasks: [],
          attachments: [],
          comments: [],
          reminders: [],
          isArchived: false,
          isFavorite: false,
          customFields: {},
          // Clearable optionals are always present (null when unset) so clearing
          // them round-trips to other clients. completedAt is a real Date here
          // because the update marked the task completed.
          dueDate: null,
          scheduledDate: null,
          assignee: null,
          parentTaskId: null,
          completedAt: expect.any(Date),
          recurringPattern: null,
          activities: [
            {
              id: expect.any(String),
              type: 'status_changed',
              description: 'Status changed from todo to completed',
              author: 'user',
              timestamp: expect.any(Date),
            },
          ],
        },
      },
    });
  });

  it('enqueues a delete per cascaded task id', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [
        {
          id: 'parent',
          title: 'Parent',
          priority: 'low',
          status: 'todo',
          category: 'eng',
          tags: [],
          subtasks: ['child'],
          attachments: [],
          notes: '',
          progress: 0,
          comments: [],
          activities: [],
          isArchived: false,
          isFavorite: false,
          customFields: {},
          reminders: [],
          projectId: 'proj-1',
        },
        {
          id: 'child',
          title: 'Child',
          priority: 'low',
          status: 'todo',
          category: 'eng',
          tags: [],
          subtasks: [],
          attachments: [],
          notes: '',
          progress: 0,
          comments: [],
          activities: [],
          isArchived: false,
          isFavorite: false,
          customFields: {},
          reminders: [],
          projectId: 'proj-1',
        },
      ],
    });
    const actions = createTaskActions(set, get);

    actions.deleteTask('parent');

    // Both the parent and its subtask are deleted, and each enqueues its own
    // cloud delete.
    const operations = mockedEnqueue.mock.calls.map(
      (c) => (c[0] as { entityId: string; operation: string }).operation
    );
    expect(mockedEnqueue).toHaveBeenCalledTimes(2);
    expect(operations).toEqual(['delete', 'delete']);
    const deletedIds = mockedEnqueue.mock.calls.map(
      (c) => (c[0] as { entityId: string }).entityId
    );
    expect(deletedIds.sort()).toEqual(['child', 'parent']);
    expect(get().tasks).toHaveLength(0);
  });

  it('does not enqueue when the task resolves to no project', () => {
    const { get, set } = makeStore({
      projects: [],
      activeProjectId: null,
      tasks: [],
    });
    const actions = createTaskActions(set, get);

    actions.addTask(taskInput());
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});
