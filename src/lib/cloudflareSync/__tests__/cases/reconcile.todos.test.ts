import { diffSnapshot } from '../../reconcile';
import { todo, emptyServer, snapJson, T2 } from './reconcile.shared';

describe('diffSnapshot — todos (no timestamp, content-based)', () => {
  it('creates a missing local todo and pushes a local-only todo', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td-missing',
        T2.toISOString(),
        '{"text":"todo-td-missing","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td-local')],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'todo',
      operation: 'create',
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'todo',
      operation: 'create',
    });
  });

  it('pushes a locally-changed todo (content differs from server)', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"server-text","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1', { text: 'local-text' })],
      server,
    });
    // No pull (server present) but a push (keep local authoritative).
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].entityId).toBe('td1');
  });

  it('skips a todo whose content already matches the server', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"todo-td1","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1')],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });

  it('deletes a local todo when the server marks it deleted', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"todo-td1","completed":false,"category":null}',
        {
          deleted_at: T2.toISOString(),
        }
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1')],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
  });
});
