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

describe('diffSnapshot — queued-mutation skip (D9)', () => {
  it('does not resurrect a locally-deleted entity with a queued delete', () => {
    const server = emptyServer();
    // Snapshot still shows l1 live (the local delete has not reached the server).
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [] })], // link absent locally
      tasks: [],
      notes: [],
      todos: [],
      server,
      queuedEntityIds: ['l1'], // a delete mutation is queued for l1
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });

  it('does not push a locally-edited entity that already has a queued mutation', () => {
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
      queuedEntityIds: ['l1'],
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });
});
