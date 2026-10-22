/**
 * Lagging-client fallback (scale-sync-backend, change-log-retention): when the
 * sync response carries `reconcileRequired: true` (our incremental cursor
 * predates the server's pruned change-log window), the response's `changes`
 * are empty BY DESIGN and the client must NOT merge them — it must fall back
 * to the full snapshot reconcile instead. A normal response keeps the plain
 * incremental path and never hits the snapshot endpoint.
 *
 * Covered at both response-handling call sites:
 * - the background pass (`backgroundSyncAll`), against chrome.storage + fetch;
 * - the popup pass (`syncProjectNow`), against a mocked app store + fetch.
 */
import { backgroundSyncAll } from '../backgroundSync';
import type { CloudMutation, CloudSyncChange } from '../types';

// --- Shared fixtures ---------------------------------------------------------

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

/** Decoy row the flagged response must NOT merge (it is empty on real servers;
 * carrying it here proves the client-side guard, not just the wire shape). */
const DECOY_CHANGE: CloudSyncChange = {
  id: 500,
  change_id: 'decoy-1',
  project_id: 'p1',
  actor_id: 'u-other',
  entity_type: 'collection',
  entity_id: 'col-decoy',
  operation: 'create',
  patch: { name: 'Decoy collection', order: 9 },
  base_version: null,
  client_mutation_id: null,
  client_id: 'ext-other',
  created_at: '2026-06-16T12:00:02.000Z',
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

function snapCollection(id: string) {
  return {
    id,
    project_id: 'p1',
    collection_id: null,
    name: `coll-${id}`,
    description: null,
    color: '#fff',
    minimized: 0,
    order_index: null,
    bookmark_folder_id: null,
    updated_at: '2026-06-16T12:00:05.000Z',
    deleted_at: null,
    version: 1,
  };
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

/** In-memory chrome.storage.local (same shape as backgroundSync.test.ts). */
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
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
          cb();
        },
      },
    },
  };
  return store;
}

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
            cloudRole: 'editor',
            collections: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        notes: [],
        todos: [],
        tasks: [],
        cloudSync: { enabled: true, cursors: { p1: 2 } },
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

/** Route fetch by path: sync POST, snapshot GET, project detail GET. */
function routeFetch(handlers: {
  sync: unknown;
  snapshot?: unknown;
  projectDetail?: unknown;
}): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.includes('/sync')) return jsonOk(handlers.sync);
    if (url.includes('/snapshot')) {
      if (!handlers.snapshot) {
        throw new Error('unexpected snapshot request');
      }
      return jsonOk(handlers.snapshot);
    }
    if (url.includes(`/projects/`)) {
      if (!handlers.projectDetail) {
        throw new Error('unexpected project request');
      }
      return jsonOk(handlers.projectDetail);
    }
    throw new Error(`unexpected request: ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const PROJECT_DETAIL = {
  project: { id: 'p1', name: 'P1' },
  role: 'editor',
};

// --- Background pass ---------------------------------------------------------

describe('backgroundSyncAll reconcileRequired fallback', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('routes a flagged response to the snapshot reconcile: snapshot fetched, incremental merge skipped, cursor still advanced', async () => {
    const store = seedStore();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = routeFetch({
      sync: {
        cursor: 99,
        changes: [DECOY_CHANGE], // must NOT be merged on the flagged path
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
        reconcileRequired: true,
      },
      snapshot: {
        collections: [snapCollection('col-snap')],
        links: [],
        tasks: [],
        notes: [],
        todos: [],
      },
      projectDetail: PROJECT_DETAIL,
    });

    const result = await backgroundSyncAll();

    // The sync ran and the snapshot endpoint was hit by the fallback.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/projects/p1/sync',
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/projects/p1/snapshot',
      expect.anything()
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reconcileRequired')
    );

    // The incremental merge was skipped: the decoy change is absent and the
    // project state came from the snapshot diff instead.
    const state = readState(store);
    expect(state.projects[0].collections.map((c) => c.id)).toEqual([
      'col-snap',
    ]);
    // The cursor still advanced to the response's fresh value (loop guard),
    // the applied mutation left the queue, and the lock was released.
    expect(state.cloudSync.cursors.p1).toBe(99);
    expect(store['cloud-sync-mutation-queue']).toEqual([]);
    expect(store['cloud-sync-lock']).toBeUndefined();
    expect(result.projects).toBe(1);
  });

  it('does not reconcile on a normal incremental response', async () => {
    const store = seedStore();
    const fetchMock = routeFetch({
      sync: {
        cursor: 5,
        changes: [REMOTE_CHANGE],
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
      },
      // No snapshot handler: any snapshot request would throw and fail.
      projectDetail: PROJECT_DETAIL,
    });

    await backgroundSyncAll();

    const snapshotCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/snapshot')
    );
    expect(snapshotCalls).toEqual([]);

    const state = readState(store);
    expect(state.projects[0].collections.map((c) => c.id)).toEqual([
      'col-remote',
    ]);
    expect(state.cloudSync.cursors.p1).toBe(5);
  });
});

// --- Popup pass --------------------------------------------------------------

describe('syncProjectNow reconcileRequired fallback', () => {
  const realFetch = global.fetch;

  const cursors: Record<string, number> = {};
  const mockStore = {
    cloudSync: { enabled: true, cursors, status: 'idle' as string },
    projects: [
      {
        id: 'p1',
        cloudEnabled: true,
        cloudRole: 'editor',
        collections: [] as Array<{ id: string }>,
      },
    ],
    tasks: [],
    notes: [],
    todos: [],
    syncConflicts: [] as unknown[],
    mergeRemoteChanges: jest.fn(),
    setProjectCursor: jest.fn((projectId: string, cursor: number) => {
      cursors[projectId] = cursor;
    }),
    setCloudSyncState: jest.fn(),
    setProjectCloudRole: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    cursors.p1 = 2;
    mockStore.cloudSync = { enabled: true, cursors, status: 'idle' };
    mockStore.projects = [
      {
        id: 'p1',
        cloudEnabled: true,
        cloudRole: 'editor',
        collections: [],
      },
    ];
    mockStore.mergeRemoteChanges.mockClear();
    mockStore.setProjectCursor.mockClear();
    mockStore.setCloudSyncState.mockClear();
    mockStore.setProjectCloudRole.mockClear();
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function bootOrchestrator(): Promise<typeof import('../orchestrator/sync')> {
    jest.mock('@/stores/appStore', () => ({
      useAppStore: { getState: () => mockStore },
    }));
    return import('../orchestrator/sync');
  }

  it('routes a flagged response to the snapshot reconcile: snapshot fetched, incremental merge skipped, cursor advanced', async () => {
    seedStore({ 'cloud-sync-mutation-queue': [] });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = routeFetch({
      sync: {
        cursor: 99,
        changes: [DECOY_CHANGE], // must NOT be merged on the flagged path
        conflicts: [],
        outcomes: [],
        reconcileRequired: true,
      },
      snapshot: {
        collections: [snapCollection('col-snap')],
        links: [],
        tasks: [],
        notes: [],
        todos: [],
      },
      projectDetail: PROJECT_DETAIL,
    });

    const { syncProjectNow } = await bootOrchestrator();
    await syncProjectNow('p1');

    // Snapshot endpoint hit by the fallback; flag logged.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/projects/p1/snapshot',
      expect.anything()
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reconcileRequired')
    );

    // mergeRemoteChanges ran exactly once — with the reconcile PULLS derived
    // from the snapshot, never with the (decoy-carrying) sync changes.
    expect(mockStore.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    const [merged] = mockStore.mergeRemoteChanges.mock.calls[0] as [
      CloudSyncChange[],
      string,
    ];
    expect(merged.map((c) => c.entity_id)).toEqual(['col-snap']);
    expect(merged.every((c) => c.change_id.startsWith('reconcile:'))).toBe(
      true
    );

    // Cursor advanced to the response's fresh value (loop guard).
    expect(mockStore.setProjectCursor).toHaveBeenCalledWith('p1', 99);
  });

  it('does not reconcile on a normal incremental response', async () => {
    seedStore({ 'cloud-sync-mutation-queue': [] });
    const fetchMock = routeFetch({
      sync: {
        cursor: 5,
        changes: [REMOTE_CHANGE],
        conflicts: [],
        outcomes: [],
      },
      // No snapshot handler: any snapshot request would throw and fail.
      projectDetail: PROJECT_DETAIL,
    });

    const { syncProjectNow } = await bootOrchestrator();
    await syncProjectNow('p1');

    const snapshotCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/snapshot')
    );
    expect(snapshotCalls).toEqual([]);

    // The sync response's changes were merged directly, and the cursor
    // advanced normally.
    expect(mockStore.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    const [merged] = mockStore.mergeRemoteChanges.mock.calls[0] as [
      CloudSyncChange[],
      string,
    ];
    expect(merged).toEqual([REMOTE_CHANGE]);
    expect(mockStore.setProjectCursor).toHaveBeenCalledWith('p1', 5);
  });
});
