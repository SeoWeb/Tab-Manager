import {
  mockedEnqueue,
  makeStore,
  PROJECT,
  lastCall,
  payloadOf,
  createNoteActions,
} from './entitySyncActions.shared';

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
