import {
  getQueue,
  enqueueMutation,
  removeMutations,
  dirtyFieldsFromPatch,
  pendingEditsFromQueue,
} from '../queue';
import type { CloudMutation } from '../types';

/** In-memory chrome.storage.local mock that keeps structured values as-is. */
function installChromeStorage(
  initial: Record<string, unknown> = {}
): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in store) out[k] = store[k];
          // Add a small artificial delay to simulate async disk I/O and reveal race conditions
          setTimeout(() => cb(out), 5);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, obj);
          setTimeout(() => cb(), 5);
        },
        remove: (keys: string | string[], cb: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keysArr) delete store[k];
          setTimeout(() => cb(), 5);
        },
      },
    },
  };
  return store;
}

const mockMutation = (id: string): CloudMutation => ({
  clientMutationId: id,
  projectId: 'p1',
  entityType: 'task',
  entityId: `t-${id}`,
  operation: 'create',
  patch: {},
  clientId: 'c1',
  createdAt: new Date().toISOString(),
});

describe('Cloud Mutation Queue Serialization', () => {
  beforeEach(() => {
    installChromeStorage({
      'cloud-sync-mutation-queue': [],
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('serializes concurrent enqueue calls and does not drop mutations', async () => {
    // Fire off three enqueues concurrently
    const p1 = enqueueMutation(mockMutation('mut-1'));
    const p2 = enqueueMutation(mockMutation('mut-2'));
    const p3 = enqueueMutation(mockMutation('mut-3'));

    await Promise.all([p1, p2, p3]);

    const queue = await getQueue();
    expect(queue).toHaveLength(3);
    expect(queue.map((m) => m.clientMutationId)).toEqual([
      'mut-1',
      'mut-2',
      'mut-3',
    ]);
  });

  it('serializes concurrent removals and additions', async () => {
    await enqueueMutation(mockMutation('mut-1'));
    await enqueueMutation(mockMutation('mut-2'));

    // Fire off add and remove concurrently
    const p1 = enqueueMutation(mockMutation('mut-3'));
    const p2 = removeMutations(['mut-1']);
    const p3 = enqueueMutation(mockMutation('mut-4'));

    await Promise.all([p1, p2, p3]);

    const queue = await getQueue();
    expect(queue.map((m) => m.clientMutationId)).toEqual([
      'mut-2',
      'mut-3',
      'mut-4',
    ]);
  });
});

describe('dirty-field tracking', () => {
  it('derives written fields from a task patch, ignoring collectionId', () => {
    expect(
      dirtyFieldsFromPatch({
        title: 'New',
        collectionId: 'c-1',
        payload: {
          description: 'd',
          priority: 'high',
          isArchived: true,
          dueDate: null,
        },
      })
    ).toEqual(['title', 'description', 'priority', 'isArchived', 'dueDate']);
    expect(
      dirtyFieldsFromPatch({ payload: { content: 'x', isPinned: true } })
    ).toEqual(['content', 'isPinned']);
  });

  it('unions pending update fields per entity and drops deletes', () => {
    const queue: CloudMutation[] = [
      {
        clientMutationId: 'm1',
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-1',
        operation: 'update',
        patch: { title: 'A', payload: { description: 'd' } },
        clientId: 'c1',
        createdAt: new Date().toISOString(),
      },
      {
        clientMutationId: 'm2',
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-1',
        operation: 'update',
        patch: { payload: { status: 'todo', priority: 'low' } },
        clientId: 'c1',
        createdAt: new Date().toISOString(),
      },
      {
        clientMutationId: 'm3',
        projectId: 'p1',
        entityType: 'task',
        entityId: 't-1',
        operation: 'delete',
        patch: {},
        clientId: 'c1',
        createdAt: new Date().toISOString(),
      },
    ];
    expect(pendingEditsFromQueue(queue)).toEqual({
      't-1': ['title', 'description', 'status', 'priority'],
    });
  });
});
