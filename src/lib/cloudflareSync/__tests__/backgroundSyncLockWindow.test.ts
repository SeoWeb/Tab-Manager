/**
 * Background lock window + heartbeat integration (fix-cross-context-data-loss,
 * tasks 3.1 / 3.3 / 3.4).
 *
 * Two guarantees, tested against one mocked chrome.storage + chrome.alarms:
 *
 *  1. The advisory lock spans the ENTIRE background pass — including the
 *     final read-modify-write store write (`applyToStore` /
 *     `applyReconcileToStore`) — so a popup "Sync now" can never interleave
 *     its own read-modify-write inside the background's window.
 *  2. A long pass stays protected: the lock heartbeat renews the timestamp
 *     while the pass runs (a concurrent popup stays blocked far past
 *     LOCK_FRESH_MS), and a hung request is aborted at the client's 30 s
 *     timeout, which settles the pass and releases the lock for the next one.
 *
 * The chrome mock (with chrome.alarms) is installed BEFORE the modules are
 * required so syncLock's top-level onAlarm listener registers against it and
 * tests can fire the heartbeat alarm exactly like Chrome would.
 */
import { SYNC_LOCK_HEARTBEAT_ALARM } from '../syncLock';
import type { CloudMutation } from '../types';

type BackgroundSyncModule = typeof import('../backgroundSync');
type SyncLockModule = typeof import('../syncLock');

const BASE = new Date('2026-06-16T12:00:00Z').getTime();

interface Harness {
  store: Record<string, unknown>;
  created: Array<{ name: string; when: number }>;
  cleared: string[];
  listeners: Array<(alarm: { name: string }) => void>;
}

function installChrome(initial: Record<string, unknown> = {}): Harness {
  const harness: Harness = {
    store: { ...initial },
    created: [],
    cleared: [],
    listeners: [],
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr)
            if (k in harness.store) out[k] = harness.store[k];
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(harness.store, obj);
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys])
            delete harness.store[k];
          cb();
        },
      },
    },
    alarms: {
      create: jest.fn((name: string, info: { when: number }) => {
        harness.created.push({ name, when: info.when });
      }),
      clear: jest.fn((name: string) => {
        harness.cleared.push(name);
        return Promise.resolve(name);
      }),
      onAlarm: {
        addListener: jest.fn((fn: (alarm: { name: string }) => void) => {
          harness.listeners.push(fn);
        }),
      },
    },
  };
  return harness;
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

function seedStore(harness: Harness): void {
  Object.assign(harness.store, {
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
  });
}

function readState(harness: Harness): {
  projects: Array<{ id: string; collections: Array<{ id: string }> }>;
  cloudSync: { cursors: Record<string, number>; status: string };
} {
  const raw = harness.store['tab-manager-storage'] as string;
  return JSON.parse(raw).state;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Drain microtasks until `predicate` holds (bounded) — the pass performs
 * several awaited storage round trips before its fetch fires, and each await
 * consumes a couple of ticks.
 */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i += 1) {
    await Promise.resolve();
  }
  await flushMicrotasks();
}

async function fireHeartbeatAt(
  harness: Harness,
  timeMs: number
): Promise<void> {
  jest.setSystemTime(new Date(timeMs));
  for (const listener of harness.listeners) {
    listener({ name: SYNC_LOCK_HEARTBEAT_ALARM });
  }
  await flushMicrotasks();
}

/**
 * Record whether the advisory lock was held at the moment the background pass
 * wrote the persisted store (the read-modify-write the lock must cover).
 */
function trackStoreWrites(harness: Harness): Array<boolean> {
  const lockPresentAtWrite: Array<boolean> = [];
  const chromeMock = (
    globalThis as unknown as {
      chrome: {
        storage: {
          local: {
            set: (obj: Record<string, unknown>, cb: () => void) => void;
          };
        };
      };
    }
  ).chrome;
  const origSet = chromeMock.storage.local.set.bind(chromeMock.storage.local);
  chromeMock.storage.local.set = (obj, cb) => {
    if (Object.prototype.hasOwnProperty.call(obj, 'tab-manager-storage')) {
      lockPresentAtWrite.push(harness.store['cloud-sync-lock'] !== undefined);
    }
    origSet(obj, cb);
  };
  return lockPresentAtWrite;
}

describe('background sync lock window', () => {
  let harness: Harness;
  let backgroundSync: BackgroundSyncModule;
  let syncLock: SyncLockModule;
  const realFetch = global.fetch;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers({ now: new Date(BASE) });
    harness = installChrome();
    seedStore(harness);
    backgroundSync = await import('../backgroundSync');
    syncLock = await import('../syncLock');
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('holds the lock across the incremental pass store write', async () => {
    const lockPresentAtWrite = trackStoreWrites(harness);
    global.fetch = jest.fn(async () =>
      jsonOk({
        cursor: 5,
        changes: [],
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
      })
    ) as unknown as typeof fetch;

    const result = await backgroundSync.backgroundSyncAll();

    expect(result).toEqual({ projects: 1, status: 'synced' });
    // Exactly one store write (the apply), and the lock was STILL HELD when
    // it happened — the popup cannot interleave a read-modify-write there.
    expect(lockPresentAtWrite).toEqual([true]);
    // Released afterwards, heartbeat alarm cleared.
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);
  });

  it('holds the lock across the reconcile pass store write', async () => {
    seedStore(harness);
    harness.store['cloud-sync-mutation-queue'] = [];
    const lockPresentAtWrite = trackStoreWrites(harness);
    global.fetch = jest.fn(async () =>
      jsonOk({
        collections: [
          {
            id: 'col-remote',
            project_id: 'p1',
            collection_id: null,
            name: 'Remote collection',
            description: null,
            color: '#fff',
            minimized: 0,
            order_index: null,
            bookmark_folder_id: null,
            updated_at: '2026-06-16T12:00:05.000Z',
            deleted_at: null,
            version: 1,
          },
        ],
        links: [],
        tasks: [],
        notes: [],
        todos: [],
      })
    ) as unknown as typeof fetch;

    const result = await backgroundSync.backgroundReconcileAll();

    expect(result).toEqual({ projects: 1, status: 'synced' });
    // The pulled collection was folded in, and the lock was still held while
    // the store was written.
    expect(lockPresentAtWrite).toEqual([true]);
    expect(readState(harness).projects[0].collections.map((c) => c.id)).toEqual(
      ['col-remote']
    );
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);
  });

  it('a long pass renews the lock via heartbeat and a concurrent popup sync stays blocked', async () => {
    let releaseSync!: () => void;
    const fetchMock = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          // The sync request hangs for 70 s (a huge queue, a slow network).
          releaseSync = () =>
            resolve(
              jsonOk({
                cursor: 5,
                changes: [],
                conflicts: [],
                outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
              })
            );
        })
    ) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const pass = backgroundSync.backgroundSyncAll();
    await flushUntil(() => (fetchMock as jest.Mock).mock.calls.length > 0);

    // The pass holds the lock and armed the heartbeat for +30 s.
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE,
    });
    expect(harness.created).toEqual([
      { name: SYNC_LOCK_HEARTBEAT_ALARM, when: BASE + 30_000 },
    ]);

    // t+30 s: the alarm fires, the lock timestamp is renewed, re-armed.
    await fireHeartbeatAt(harness, BASE + 30_000);
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE + 30_000,
    });
    expect(harness.created[1]).toEqual({
      name: SYNC_LOCK_HEARTBEAT_ALARM,
      when: BASE + 60_000,
    });

    // t+89_999 ms: nearly 90 s into the pass — without the renewal the lock
    // (stamped at BASE) would be long stale and the popup could start a
    // concurrent sync inside the background's read-modify-write window.
    jest.setSystemTime(new Date(BASE + 89_999));
    await expect(syncLock.acquireSyncLock('popup')).resolves.toBe(false);
    expect((harness.store['cloud-sync-lock'] as { owner: string }).owner).toBe(
      'background'
    );

    // The pass finishes: lock released, heartbeat cleared.
    releaseSync();
    const result = await pass;
    expect(result).toEqual({ projects: 1, status: 'synced' });
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);
  });

  it('a hung request aborts at the timeout, releases the lock, and the next pass acquires it', async () => {
    let hungSignal: AbortSignal | null = null;
    const hungFetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // A server that never answers: only the client timeout can end it.
          hungSignal = (init?.signal as AbortSignal) ?? null;
          const onAbort = () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          };
          if (hungSignal?.aborted) onAbort();
          else hungSignal?.addEventListener('abort', onAbort);
        })
    ) as unknown as jest.Mock;
    global.fetch = hungFetch as unknown as typeof fetch;

    const pass = backgroundSync.backgroundSyncAll();
    await flushUntil(() => hungFetch.mock.calls.length > 0);
    expect(hungSignal).not.toBeNull();
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE,
    });

    // 30 s in, the client timeout aborts the request; the pass settles.
    await jest.advanceTimersByTimeAsync(30_000);
    const result = await pass;

    expect(result).toEqual({ projects: 0, status: 'error' });
    expect((hungSignal as AbortSignal | null)?.aborted).toBe(true);
    // The stranded lock did NOT stay held: released despite the hang, with
    // the heartbeat alarm cleared alongside it.
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);

    // The next pass can acquire the lock and succeed.
    global.fetch = jest.fn(async () =>
      jsonOk({
        cursor: 5,
        changes: [],
        conflicts: [],
        outcomes: [{ clientMutationId: 'mut-1', status: 'applied' }],
      })
    ) as unknown as typeof fetch;
    const second = await backgroundSync.backgroundSyncAll();
    expect(second).toEqual({ projects: 1, status: 'synced' });
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
  });
});
