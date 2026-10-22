import {
  getQueue,
  enqueueMutation,
  removeMutations,
  dirtyFieldsFromPatch,
  pendingEditsFromQueue,
  settleMutationOutcomes,
  getPushableQueueForProject,
  getConflictedCount,
  countConflicted,
  releaseConflictedForEntity,
} from '../queue';
import type { CloudMutation, SyncMutationOutcome } from '../types';

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

describe('conflicted mutation retention (fix-cross-context-data-loss 7.1)', () => {
  beforeEach(() => {
    installChromeStorage({
      'cloud-sync-mutation-queue': [],
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  const updateMutation = (
    id: string,
    entityId = 't-1',
    conflicted?: boolean
  ): CloudMutation => ({
    clientMutationId: id,
    projectId: 'p1',
    entityType: 'task',
    entityId,
    operation: 'update',
    patch: { title: id },
    clientId: 'c1',
    createdAt: new Date().toISOString(),
    ...(conflicted !== undefined ? { conflicted } : {}),
  });

  const outcome = (
    clientMutationId: string,
    status: SyncMutationOutcome['status']
  ): SyncMutationOutcome => ({ clientMutationId, status });

  it('flags conflicted mutations in place and keeps them queued; applied/skipped are released', async () => {
    await enqueueMutation(updateMutation('m-keep'));
    await enqueueMutation(updateMutation('m-conflict'));
    await enqueueMutation(updateMutation('m-applied'));
    await enqueueMutation(updateMutation('m-skip'));
    await enqueueMutation(updateMutation('m-error'));

    const settlement = await settleMutationOutcomes(await getQueue(), [
      outcome('m-conflict', 'conflict'),
      outcome('m-applied', 'applied'),
      outcome('m-skip', 'skipped'),
      outcome('m-error', 'error'),
    ]);

    // The conflicted mutation survives, flagged; applied/skipped are gone;
    // the errored one stays queued unflagged (plain retry path).
    const queue = await getQueue();
    expect(queue.map((m) => m.clientMutationId)).toEqual([
      'm-keep',
      'm-conflict',
      'm-error',
    ]);
    const conflictedEntry = queue.find(
      (m) => m.clientMutationId === 'm-conflict'
    );
    expect(conflictedEntry?.conflicted).toBe(true);
    expect(
      queue.find((m) => m.clientMutationId === 'm-error')?.conflicted
    ).toBe(undefined);
    expect(settlement.released.map((m) => m.clientMutationId)).toEqual([
      'm-applied',
      'm-skip',
    ]);
    expect(settlement.conflicted.map((m) => m.clientMutationId)).toEqual([
      'm-conflict',
    ]);
    expect(settlement.queue).toEqual(queue);
  });

  it('is idempotent: re-settling an already-flagged entry does not duplicate or unflag it', async () => {
    await enqueueMutation(updateMutation('m-conflict'));
    const first = await settleMutationOutcomes(
      [updateMutation('m-conflict')],
      [outcome('m-conflict', 'conflict')]
    );
    const second = await settleMutationOutcomes(
      [updateMutation('m-conflict')],
      [outcome('m-conflict', 'conflict')]
    );

    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].conflicted).toBe(true);
    expect(second.conflicted).toHaveLength(1);
    expect(second.conflicted[0].clientMutationId).toBe('m-conflict');
    expect(first.queue).toEqual(queue);
  });

  it('excludes conflicted entries from the pushable queue but counts them', async () => {
    await enqueueMutation(updateMutation('m-ok', 't-1'));
    await enqueueMutation(updateMutation('m-stale', 't-2'));
    await settleMutationOutcomes(await getQueue(), [
      outcome('m-stale', 'conflict'),
    ]);

    expect(
      (await getPushableQueueForProject('p1')).map((m) => m.clientMutationId)
    ).toEqual(['m-ok']);
    expect(await getConflictedCount()).toBe(1);
    const queue = await getQueue();
    expect(countConflicted(queue)).toBe(1);
    expect(
      countConflicted([...queue, updateMutation('m-x', 't-3', true)])
    ).toBe(2);
  });

  it('releases conflicted entries keyed by entity, preserving other entries', async () => {
    await enqueueMutation(updateMutation('m-1', 't-1'));
    await enqueueMutation(updateMutation('m-2', 't-1'));
    await enqueueMutation(updateMutation('m-3', 't-2'));
    await enqueueMutation(updateMutation('m-4', 't-1'));
    await settleMutationOutcomes(await getQueue(), [
      outcome('m-1', 'conflict'),
      outcome('m-2', 'conflict'),
      outcome('m-3', 'conflict'),
      // m-4 was applied — not conflicted.
      outcome('m-4', 'applied'),
    ]);

    // A fresh resolution push for t-1 lands (unflagged) before release.
    await enqueueMutation(updateMutation('m-fresh', 't-1'));

    const remaining = await releaseConflictedForEntity({
      projectId: 'p1',
      entityType: 'task',
      entityId: 't-1',
    });

    // Both conflicted t-1 entries are gone; the conflicted t-2 entry and the
    // fresh unflagged t-1 push stay.
    expect(remaining.map((m) => m.clientMutationId)).toEqual([
      'm-3',
      'm-fresh',
    ]);
    expect(await getConflictedCount()).toBe(1);
  });
});
