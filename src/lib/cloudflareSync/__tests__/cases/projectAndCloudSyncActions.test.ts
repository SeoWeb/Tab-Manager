import {
  mockedEnqueue,
  makeStore,
  PROJECT,
  lastCall,
  createProjectActions,
  createCloudSyncActions,
} from './entitySyncActions.shared';

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
