import { diffSnapshot } from '../../reconcile';
import {
  collection,
  link,
  emptyServer,
  snapCollection,
  snapLink,
  T0,
  T1,
  T2,
} from './reconcile.shared';

describe('diffSnapshot — links (nesting + legacy updatedAt backfill)', () => {
  it('creates a missing local link and keeps its parent collection', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'link',
      entity_id: 'l1',
      operation: 'create',
    });
    expect(result.pulls[0].patch).toMatchObject({ collectionId: 'c1' });
  });

  it('treats a legacy link missing updatedAt as its createdAt for LWW', () => {
    // Legacy link (no updatedAt) created at T0; server updated at T1 → server wins.
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T0.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T1.toISOString())];
    const result = diffSnapshot({
      collections: [
        collection('c1', T0, { links: [link('l1', 'c1', undefined)] }),
      ],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
    expect(result.pushes).toHaveLength(0);
  });

  it('updates a link when the server is newer', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T1)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
  });

  it('pushes a local-newer link', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T0.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T2)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('update');
  });

  it('deletes a local link when server marks it deleted', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [
      snapLink('l1', 'c1', T2.toISOString(), { deleted_at: T2.toISOString() }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T1)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
  });

  it('pushes a local-only link', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T2)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('create');
  });
});
