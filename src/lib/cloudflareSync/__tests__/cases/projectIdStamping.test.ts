import { applyRemoteChanges, change, EMPTY } from './applyChanges.shared';
import type { Note } from '@/stores/types';

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

  it('skips our own update echoes so optimistic local state is preserved', () => {
    const base = {
      ...EMPTY,
      notes: [
        {
          id: 'note-1',
          title: 'Local',
          content: 'local',
          color: '#fff',
          isPinned: false,
          projectId: 'proj-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    };
    const result = applyRemoteChanges(
      base,
      [
        change({
          operation: 'update',
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          client_id: 'ext-me', // echoed from this client
          patch: { title: 'echo', payload: { content: 'remote' } },
        }),
      ],
      'ext-me'
    );

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('Local');
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
