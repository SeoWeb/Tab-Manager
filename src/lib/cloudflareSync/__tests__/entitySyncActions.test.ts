// Phase B1: the note/todo/task action factories must enqueue cloud mutations
// with the shape the backend stores and applyChanges reads back. The real
// orchestrator pulls in the appStore (which imports ESM-only nanoid), so the
// orchestrator is mocked; the patch builders (entityPatches) run for real.

jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  enqueueCloudChange: jest.fn(),
}));
// uiActions imports nanoid (ESM-only) and tabService; stub both so the action
// factory can be imported under Jest's CJS transform.
jest.mock('nanoid', () => ({ nanoid: () => 'generated-id' }));
jest.mock('@/lib/tabService', () => ({ getAllWindows: jest.fn() }));
jest.mock('@/lib/bookmarkStorage', () => ({
  bookmarkStorage: {
    deleteProject: jest.fn(),
  },
}));
jest.mock('@/lib/bookmarkSyncService', () => ({
  bookmarkSyncService: {
    performFullSync: jest.fn(),
  },
}));

import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { createNoteActions } from '@/stores/actions/noteActions';
import { createTaskActions } from '@/stores/actions/taskActions';
import { createUIActions } from '@/stores/actions/uiActions';
import { createProjectActions } from '@/stores/actions/projectActions';
import { createCloudSyncActions } from '@/stores/actions/cloudSyncActions';
import type { AppState } from '@/stores/types';
import type { AdvancedTask } from '@/types/tasks';

const mockedEnqueue = enqueueCloudChange as jest.MockedFunction<
  typeof enqueueCloudChange
>;

/**
 * Minimal live-store harness: `set` merges partials (zustand-style), `get`
 * returns the current state. Tests only seed the slice of AppState they touch,
 * so the seed is loosely typed; it is cast to the full AppState internally and
 * only the fields actually read by the actions under test need to be present.
 */
function makeStore(initial: Record<string, unknown>) {
  let state = initial as unknown as AppState;
  const get = (): AppState => state;
  const set = (
    updater: ((s: AppState) => AppState | Partial<AppState>) | Partial<AppState>
  ): void => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial } as AppState;
  };
  return { get, set };
}

const PROJECT = { id: 'proj-1', cloudEnabled: true, collections: [] };

function lastCall() {
  const calls = mockedEnqueue.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe('noteActions cloud sync', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  it('enqueues a create with the note payload shape on addNote', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      notes: [],
    });
    const actions = createNoteActions(set, get);

    actions.addNote('Plan', 'do the thing', '#abc');

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      projectId: 'proj-1',
      entityType: 'note',
      entityId: expect.any(String),
      operation: 'create',
      patch: {
        title: 'Plan',
        payload: { content: 'do the thing', color: '#abc', isPinned: false },
      },
    });
    // The new note is stamped with the active project and stored.
    expect(get().notes[0]).toMatchObject({ projectId: 'proj-1' });
  });

  it('enqueues an update carrying the full current payload', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      notes: [
        {
          id: 'note-1',
          title: 'Old',
          content: 'old',
          color: '#fff',
          isPinned: false,
          projectId: 'proj-1',
        },
      ],
    });
    const actions = createNoteActions(set, get);

    actions.updateNote('note-1', { content: 'new content', isPinned: true });

    expect(lastCall()).toEqual({
      projectId: 'proj-1',
      entityType: 'note',
      entityId: 'note-1',
      operation: 'update',
      patch: {
        title: 'Old',
        // Full payload, not just the changed field — the backend replaces
        // payload_json wholesale, so the merged state must be sent.
        payload: { content: 'new content', color: '#fff', isPinned: true },
      },
    });
  });

  it('enqueues a delete and does not enqueue when the note has no project', () => {
    const { get, set } = makeStore({
      projects: [],
      activeProjectId: null,
      notes: [
        {
          id: 'orphan',
          title: 'x',
          content: '',
          color: '#fff',
          isPinned: false,
        },
      ],
    });
    const actions = createNoteActions(set, get);

    actions.deleteNote('orphan');
    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(get().notes).toHaveLength(0);
  });
});

describe('todo (uiActions) cloud sync', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  it('enqueues create/toggle(update)/remove(delete)', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      todos: [],
    });
    const actions = createUIActions(set, get);

    actions.addTodo('Buy milk', 'groceries');
    const todoId = get().todos[0].id;
    expect(lastCall()).toMatchObject({
      projectId: 'proj-1',
      entityType: 'todo',
      operation: 'create',
      patch: {
        title: 'Buy milk',
        payload: { text: 'Buy milk', completed: false, category: 'groceries' },
      },
    });

    actions.toggleTodo(todoId);
    expect(lastCall()).toMatchObject({
      projectId: 'proj-1',
      entityType: 'todo',
      entityId: todoId,
      operation: 'update',
      patch: {
        title: 'Buy milk',
        payload: { text: 'Buy milk', completed: true, category: 'groceries' },
      },
    });

    actions.removeTodo(todoId);
    expect(lastCall()).toMatchObject({
      projectId: 'proj-1',
      entityType: 'todo',
      entityId: todoId,
      operation: 'delete',
      patch: {},
    });
    expect(get().todos).toHaveLength(0);
  });
});

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
          completedAt: expect.any(Date),
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

/** Pull the payload object out of a recorded enqueue call (typed for access). */
function payloadOf(call: unknown): Record<string, unknown> {
  return (call as { patch: { payload: Record<string, unknown> } }).patch
    .payload;
}

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

describe('noteActions cloud sync — pin toggle and duplicate', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  const NOTE = {
    id: 'n-1',
    title: 'N',
    content: 'c',
    color: '#fff',
    isPinned: false,
    projectId: 'proj-1',
  };

  it('togglePinNote enqueues an update carrying the new isPinned', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      notes: [NOTE],
    });
    const actions = createNoteActions(set, get);

    actions.togglePinNote('n-1');

    expect(lastCall()).toMatchObject({
      projectId: 'proj-1',
      entityType: 'note',
      entityId: 'n-1',
      operation: 'update',
    });
    expect(payloadOf(lastCall()).isPinned).toBe(true);
    expect(get().notes[0].isPinned).toBe(true);
  });

  it('duplicateNote enqueues a create for the copy', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      notes: [NOTE],
    });
    const actions = createNoteActions(set, get);

    actions.duplicateNote('n-1');

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({
      entityType: 'note',
      operation: 'create',
      projectId: 'proj-1',
    });
    expect(get().notes).toHaveLength(2);
  });
});

describe('projectActions cloud sync', () => {
  beforeEach(() => mockedEnqueue.mockClear());

  it('enqueues a delete with the project id on deleteProject', () => {
    const { get, set } = makeStore({
      projects: [PROJECT],
      activeProjectId: 'proj-1',
      notes: [],
      todos: [],
      tasks: [],
    });
    const actions = createProjectActions(set, get);

    actions.deleteProject('proj-1');

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      projectId: 'proj-1',
      entityType: 'project',
      entityId: 'proj-1',
      operation: 'delete',
      patch: {},
    });
    expect(get().projects).toHaveLength(0);
  });
});

describe('cloudSyncActions setProjectCloudEnabled', () => {
  it('sets cloudRole to owner when cloudEnabled is set to false', () => {
    const { get, set } = makeStore({
      projects: [
        {
          id: 'proj-1',
          name: 'Project 1',
          cloudEnabled: true,
          cloudRole: 'viewer',
          collections: [],
        },
      ],
    });
    const actions = createCloudSyncActions(set, get);

    actions.setProjectCloudEnabled('proj-1', false);

    expect(get().projects[0].cloudEnabled).toBe(false);
    expect(get().projects[0].cloudRole).toBe('owner');
  });

  it('does not set cloudRole to owner when cloudEnabled is set to true', () => {
    const { get, set } = makeStore({
      projects: [
        {
          id: 'proj-1',
          name: 'Project 1',
          cloudEnabled: false,
          cloudRole: 'viewer',
          collections: [],
        },
      ],
    });
    const actions = createCloudSyncActions(set, get);

    actions.setProjectCloudEnabled('proj-1', true);

    expect(get().projects[0].cloudEnabled).toBe(true);
    expect(get().projects[0].cloudRole).toBe('viewer');
  });
});
