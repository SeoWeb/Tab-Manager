import {
  mockedEnqueue,
  makeStore,
  PROJECT,
  lastCall,
  payloadOf,
  createTaskActions,
} from './entitySyncActions.shared';
import type { AdvancedTask } from './entitySyncActions.shared';

describe('taskActions cloud sync — previously-unsynced mutations', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  function seedTask(overrides: Partial<AdvancedTask> = {}): AdvancedTask {
    return {
      id: 't-1',
      title: 'T',
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
      ...overrides,
    };
  }

  it('archiveTask enqueues an update carrying isArchived:true', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [seedTask()],
    });
    const actions = createTaskActions(set, get);

    actions.archiveTask('t-1');

    expect(lastCall()).toMatchObject({
      projectId: 'proj-1',
      entityType: 'task',
      entityId: 't-1',
      operation: 'update',
    });
    expect(payloadOf(lastCall()).isArchived).toBe(true);
    expect(get().tasks[0].isArchived).toBe(true);
  });

  it('unarchiveTask enqueues an update carrying isArchived:false', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [seedTask({ isArchived: true })],
    });
    const actions = createTaskActions(set, get);

    actions.unarchiveTask('t-1');

    expect(payloadOf(lastCall()).isArchived).toBe(false);
    expect(get().tasks[0].isArchived).toBe(false);
  });

  it('addSubtask enqueues a create for the subtask and an update for the parent', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [seedTask({ id: 'parent', subtasks: [] })],
    });
    const actions = createTaskActions(set, get);

    actions.addSubtask('parent', {
      title: 'Sub',
      priority: 'low',
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
    });

    const calls = mockedEnqueue.mock.calls.map((c) => ({
      op: (c[0] as { operation: string }).operation,
      id: (c[0] as { entityId: string }).entityId,
    }));
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'create' }),
        expect.objectContaining({ op: 'update', id: 'parent' }),
      ])
    );
    // The subtask exists and is linked to its parent.
    const parent = get().tasks.find((t) => t.id === 'parent');
    expect(parent?.subtasks).toHaveLength(1);
    expect(get().tasks).toHaveLength(2);
  });

  it('removeSubtask enqueues a delete for the subtask and an update for the parent', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [
        seedTask({ id: 'parent', subtasks: ['sub-1'] }),
        seedTask({ id: 'sub-1', parentTaskId: 'parent' }),
      ],
    });
    const actions = createTaskActions(set, get);

    actions.removeSubtask('parent', 'sub-1');

    const calls = mockedEnqueue.mock.calls.map((c) => ({
      op: (c[0] as { operation: string }).operation,
      id: (c[0] as { entityId: string }).entityId,
    }));
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'delete', id: 'sub-1' }),
        expect.objectContaining({ op: 'update', id: 'parent' }),
      ])
    );
    expect(get().tasks.find((t) => t.id === 'sub-1')).toBeUndefined();
    expect(get().tasks[0].subtasks).toHaveLength(0);
  });

  it('duplicateTask enqueues a create for the copy (under the same project)', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [seedTask()],
    });
    const actions = createTaskActions(set, get);

    actions.duplicateTask('t-1');

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({
      entityType: 'task',
      operation: 'create',
      projectId: 'proj-1',
    });
    expect((lastCall() as { entityId: string }).entityId).not.toBe('t-1');
    expect(get().tasks).toHaveLength(2);
  });

  it('performBulkOperation delete enqueues a delete per target', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [
        seedTask({ id: 'a' }),
        seedTask({ id: 'b' }),
        seedTask({ id: 'c' }),
      ],
    });
    const actions = createTaskActions(set, get);

    actions.performBulkOperation({ type: 'delete', taskIds: ['a', 'b'] });

    expect(mockedEnqueue).toHaveBeenCalledTimes(2);
    const ids = mockedEnqueue.mock.calls
      .map((c) => (c[0] as { entityId: string }).entityId)
      .sort();
    expect(ids).toEqual(['a', 'b']);
    expect(get().tasks).toHaveLength(1);
  });

  it('performBulkOperation archive enqueues an update per target', () => {
    const { set, get } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      tasks: [seedTask({ id: 'a' }), seedTask({ id: 'b' })],
    });
    const actions = createTaskActions(set, get);

    actions.performBulkOperation({ type: 'archive', taskIds: ['a', 'b'] });

    expect(mockedEnqueue).toHaveBeenCalledTimes(2);
    expect(
      mockedEnqueue.mock.calls.every(
        (c) => (c[0] as { operation: string }).operation === 'update'
      )
    ).toBe(true);
  });
});
