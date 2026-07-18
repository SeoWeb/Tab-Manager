import { diffSnapshot } from '../../reconcile';
import {
  collection,
  emptyServer,
  snapCollection,
  T0,
  T1,
  T2,
} from './reconcile.shared';

describe('diffSnapshot — collections', () => {
  it('creates a missing local collection', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'collection',
      entity_id: 'c1',
      operation: 'create',
      client_id: null,
    });
    expect(result.pushes).toHaveLength(0);
  });

  it('updates a local collection when the server is newer', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
    expect(result.pushes).toHaveLength(0);
  });

  it('pushes a local collection when it is newer', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T0.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T2)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'collection',
      entityId: 'c1',
      operation: 'update',
    });
  });

  it('deletes a local collection when the server row is soft-deleted', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T2.toISOString(), { deleted_at: T2.toISOString() }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
    expect(result.pushes).toHaveLength(0);
  });

  it('pushes a local-only collection (no server row)', () => {
    const server = emptyServer();
    const result = diffSnapshot({
      collections: [collection('c1', T2)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('create');
  });
});
