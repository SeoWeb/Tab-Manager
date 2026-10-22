import { backgroundSyncAll } from '../backgroundSync';
import type { CloudMutation, CloudSyncChange } from '../types';

/** In-memory chrome.storage.local that keeps structured values as-is. */
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
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, obj);
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keysArr) delete store[k];
          cb();
        },
      },
    },
  };
  return store;
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const MUTATION: CloudMutation = {
  clientMutationId: 'mut-1',
  projectId: 'p1',
  entityType: 'collection',
  entityId: 'col-local',
  operation: 'create',
  patch: { name: 'Local collection', order: 0 },
  clientId: 'ext-test',
  createdAt: '2026-06-16T12:00:00.000Z',
};

const REMOTE_CHANGE: CloudSyncChange = {
  id: 5,
  change_id: 'srv-1',
  project_id: 'p1',
  actor_id: 'u-other',
  entity_type: 'collection',
  entity_id: 'col-remote',
  operation: 'create',
  patch: { name: 'Remote collection', order: 1 },
  base_version: null,
  client_mutation_id: null,
  client_id: 'ext-other',
  created_at: '2026-06-16T12:00:01.000Z',
};

function seedStore(
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return installChromeStorage({
    'cloud-sync-client-id': 'ext-test',
    'cloud-sync-api-base-url': 'http://localhost:8787',
    'cloud-sync-token': 'tok',
    'cloud-sync-mutation-queue': [MUTATION],
    'cloud-sync-lock': undefined,
    'tab-manager-storage': JSON.stringify({
      state: {
        projects: [
          {
            id: 'p1',
            cloudEnabled: true,
            collections: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        notes: [],
        todos: [],
        tasks: [],
        cloudSync: { enabled: true, cursors: {} },
      },
      version: 1,
    }),
    ...extra,
  });
}

function readState(store: Record<string, unknown>): {
  projects: Array<{ id: string; collections: Array<{ id: string }> }>;
  cloudSync: { cursors: Record<string, number>; status: string };
} {
  const raw = store['tab-manager-storage'] as string;
  return JSON.parse(raw).state;
}

describe('backgroundSyncAll', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('pushes queued mutations, pulls remote changes, applies them, and clears the queue', async () => {
    const store = seedStore();
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      // Assert the request was a sync POST carrying the queued mutation.
      expect(url).toBe('http://localhost:8787/projects/p1/sync');
      const body = JSON.parse(init?.body as string);
      expect(body.mutations).toHaveLength(1);
      expect(body.mutations[0].clientMutationId).toBe('mut-1');
      return jsonOk({
        cursor: 5,
        changes: [REMOTE_CHANGE],
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await backgroundSyncAll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ projects: 1, status: 'synced' });

    // The pushed mutation was removed from the queue.
    expect(store['cloud-sync-mutation-queue']).toEqual([]);

    // The remote change was applied to the project's collections, the cursor
    // advanced, and the lock released.
    const state = readState(store);
    expect(state.projects[0].collections.map((c) => c.id)).toEqual([
      'col-remote',
    ]);
    expect(state.cloudSync.cursors.p1).toBe(5);
    expect(state.cloudSync.status).toBe('synced');
    expect(store['cloud-sync-lock']).toBeUndefined();
  });

  it('skips entirely when another context holds a fresh lock', async () => {
    const store = seedStore({
      'cloud-sync-lock': { owner: 'popup', ts: Date.now() },
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await backgroundSyncAll();

    expect(result).toEqual({ projects: 0, status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
    // Queue untouched.
    expect(store['cloud-sync-mutation-queue']).toHaveLength(1);
  });

  it('surfaces conflicts in status without dropping the cursor', async () => {
    const store = seedStore();
    global.fetch = jest.fn(async () =>
      jsonOk({
        cursor: 6,
        changes: [],
        conflicts: [
          {
            entityType: 'collection',
            entityId: 'col-local',
            clientMutationId: 'mut-1',
            message: 'Entity version conflict',
            currentVersion: 3,
          },
        ],
        outcomes: [
          {
            clientMutationId: 'mut-1',
            status: 'conflict',
            message: 'Entity version conflict',
          },
        ],
      })
    ) as unknown as typeof fetch;

    const result = await backgroundSyncAll();
    expect(result.status).toBe('conflict');

    const state = readState(store);
    expect(state.cloudSync.status).toBe('conflict');
    expect(state.cloudSync.cursors.p1).toBe(6);
    // The conflicted mutation is RETAINED, flagged `conflicted`
    // (fix-cross-context-data-loss 7.1) — the local edit stays queued until
    // the user resolves or discards the conflict.
    const queued = store['cloud-sync-mutation-queue'] as Array<{
      clientMutationId: string;
      conflicted?: boolean;
    }>;
    expect(queued).toHaveLength(1);
    expect(queued[0].clientMutationId).toBe('mut-1');
    expect(queued[0].conflicted).toBe(true);
  });

  it('is a no-op when cloud sync is disabled', async () => {
    seedStore({
      'tab-manager-storage': JSON.stringify({
        state: { projects: [], cloudSync: { enabled: false, cursors: {} } },
        version: 1,
      }),
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await backgroundSyncAll();
    expect(result).toEqual({ projects: 0, status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops skipped mutations with a warning and never retries them', async () => {
    const store = seedStore();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init?.body as string);
      if (calls === 1) {
        // First pass: the server permanently rejects the mutation.
        expect(body.mutations).toHaveLength(1);
        return jsonOk({
          cursor: 7,
          changes: [],
          conflicts: [],
          outcomes: [
            {
              clientMutationId: 'mut-1',
              status: 'skipped',
              reason: 'project_mismatch',
            },
          ],
        });
      }
      // Second pass: nothing left to push — skipped mutations are not retried.
      expect(body.mutations).toEqual([]);
      return jsonOk({
        cursor: 8,
        changes: [],
        conflicts: [],
        outcomes: [],
      });
    }) as unknown as typeof fetch;

    const first = await backgroundSyncAll();
    expect(first.status).toBe('synced');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mut-1'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('project_mismatch')
    );

    await backgroundSyncAll();

    expect(store['cloud-sync-mutation-queue']).toEqual([]);
    warnSpy.mockRestore();
  });

  it('keeps errored mutations queued for the next sync pass', async () => {
    const store = seedStore();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init?.body as string);
      if (calls === 1) {
        expect(body.mutations).toHaveLength(1);
        return jsonOk({
          cursor: 9,
          changes: [],
          conflicts: [],
          outcomes: [
            {
              clientMutationId: 'mut-1',
              status: 'error',
              message: 'payload too large',
            },
          ],
        });
      }
      // Second pass: the errored mutation is retried and now applied.
      expect(
        body.mutations.map(
          (m: { clientMutationId: string }) => m.clientMutationId
        )
      ).toEqual(['mut-1']);
      return jsonOk({
        cursor: 10,
        changes: [],
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
      });
    }) as unknown as typeof fetch;

    const first = await backgroundSyncAll();
    expect(first.status).toBe('synced');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('mut-1'));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('payload too large')
    );
    // The mutation survived the errored pass...
    expect(store['cloud-sync-mutation-queue']).toHaveLength(1);

    // ...and was retried and drained on the next pass.
    await backgroundSyncAll();
    expect(store['cloud-sync-mutation-queue']).toEqual([]);
    errorSpy.mockRestore();
  });

  it('keeps mutations queued when the response has no outcome for them', async () => {
    const store = seedStore();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () =>
      jsonOk({
        cursor: 11,
        changes: [],
        conflicts: [],
        // Missing entry for mut-1: conservative — never drop silently.
        outcomes: [],
      })
    ) as unknown as typeof fetch;

    const result = await backgroundSyncAll();

    expect(result.status).toBe('synced');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no outcome reported for mutation mut-1')
    );
    expect(store['cloud-sync-mutation-queue']).toHaveLength(1);
    warnSpy.mockRestore();
  });
});
