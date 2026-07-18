import {
  mockedEnqueue,
  makeStore,
  PROJECT,
  lastCall,
  createNoteActions,
  createUIActions,
} from './entitySyncActions.shared';

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
