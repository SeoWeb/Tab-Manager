import { diffSnapshot } from '../../reconcile';
import { task, emptyServer, snapJson, T1, T2 } from './reconcile.shared';

describe('diffSnapshot — tasks', () => {
  it('creates a missing local task and pushes a local-only task', () => {
    const server = emptyServer();
    server.tasks = [
      snapJson(
        't-missing',
        T2.toISOString(),
        '{"title":"task-t-missing","priority":"medium","status":"todo","category":"general","tags":[],"notes":"","progress":0,"isArchived":false,"isFavorite":false}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [task('t-local', T2)],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'task',
      operation: 'create',
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'task',
      operation: 'create',
    });
  });

  it('updates a task when the server is newer', () => {
    const server = emptyServer();
    server.tasks = [
      snapJson(
        't1',
        T2.toISOString(),
        '{"title":"task-t1","priority":"medium","status":"todo","category":"general","tags":[],"notes":"","progress":0,"isArchived":false,"isFavorite":false}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [task('t1', T1)],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
  });
});
