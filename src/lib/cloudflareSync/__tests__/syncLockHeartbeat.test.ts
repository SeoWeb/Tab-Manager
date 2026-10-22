/**
 * Lock heartbeat (fix-cross-context-data-loss, task 3.3/3.4).
 *
 * A background sync that legitimately runs longer than LOCK_FRESH_MS must not
 * have its advisory lock stolen mid-window: while the lock is held, a
 * `chrome.alarms` one-shot (SYNC_LOCK_HEARTBEAT_ALARM, 30 s) refreshes the
 * lock timestamp and re-arms itself. The heartbeat stops on release, when the
 * lock disappears or is stolen underneath it, and at worker boot (claim +
 * alarm dropped so a dead sync cannot pin the lock fresh forever).
 *
 * The chrome.alarms mock is installed BEFORE the module is (re)required, so
 * the module's top-level onAlarm listener registration lands on the mock and
 * tests can fire the alarm by invoking the captured listener — exactly what
 * Chrome does.
 */
import { SYNC_LOCK_HEARTBEAT_ALARM } from '../syncLock';

type SyncLockModule = typeof import('../syncLock');

const BASE = new Date('2026-06-16T12:00:00Z').getTime();

/** Just past the freshness horizon. */
const LOCK_STALE_MS = 60_000 + 1_000;

interface AlarmHarness {
  store: Record<string, unknown>;
  created: Array<{ name: string; when: number }>;
  cleared: string[];
  listeners: Array<(alarm: { name: string }) => void>;
}

function installChromeWithAlarms(): AlarmHarness {
  const harness: AlarmHarness = {
    store: {},
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

/** Drain the promise chains (storage callbacks in the mock are synchronous). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

/** Simulate Chrome firing the heartbeat alarm at `timeMs`, then settle. */
async function fireHeartbeatAt(
  harness: AlarmHarness,
  timeMs: number
): Promise<void> {
  jest.setSystemTime(new Date(timeMs));
  for (const listener of harness.listeners) {
    listener({ name: SYNC_LOCK_HEARTBEAT_ALARM });
  }
  await flushMicrotasks();
}

describe('sync lock heartbeat', () => {
  let harness: AlarmHarness;
  let syncLock: SyncLockModule;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers({ now: new Date(BASE) });
    harness = installChromeWithAlarms();
    // Required (not imported) so the module's top-level onAlarm listener
    // registers against THIS test's alarms mock, and the in-memory
    // heartbeat claim starts clean.
    syncLock = await import('../syncLock');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('arms a 30 s one-shot when started', async () => {
    await syncLock.acquireSyncLock('background');
    await expect(syncLock.startSyncLockHeartbeat('background')).resolves.toBe(
      true
    );

    expect(harness.created).toEqual([
      { name: SYNC_LOCK_HEARTBEAT_ALARM, when: BASE + 30_000 },
    ]);
  });

  it('renews the lock timestamp and re-arms on every tick', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');

    await fireHeartbeatAt(harness, BASE + 30_000);
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE + 30_000,
    });
    // Re-armed for the next beat.
    expect(harness.created).toEqual([
      { name: SYNC_LOCK_HEARTBEAT_ALARM, when: BASE + 30_000 },
      { name: SYNC_LOCK_HEARTBEAT_ALARM, when: BASE + 60_000 },
    ]);
  });

  it('keeps a renewed lock blocking a concurrent popup sync far past the original freshness window', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');

    // One beat at t+30 s, then jump almost to t+90 s: a lock stamped at BASE
    // would be stale (LOCK_FRESH_MS = 60 s) and the popup could steal it.
    // The renewed timestamp must keep the popup out.
    await fireHeartbeatAt(harness, BASE + 30_000);
    jest.setSystemTime(new Date(BASE + 89_999));
    await expect(syncLock.acquireSyncLock('popup')).resolves.toBe(false);
    expect((harness.store['cloud-sync-lock'] as { owner: string }).owner).toBe(
      'background'
    );
  });

  it('stops beating and clears the alarm when the lock is released', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');

    await syncLock.stopSyncLockHeartbeat();
    await syncLock.releaseSyncLock('background');

    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);

    // The stopped heartbeat no longer refreshes anything.
    await syncLock.acquireSyncLock('background');
    await fireHeartbeatAt(harness, BASE + 30_000);
    // Claim is gone, so the just-acquired lock's ts is untouched...
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE,
    });
    // ...and no re-arm happened (create was called only once, at start).
    expect(harness.created).toHaveLength(1);
  });

  it('stops beating when the lock disappears underneath it', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');

    // Someone released the lock without stopping the heartbeat (e.g. the
    // releasing context died between release and stop).
    await syncLock.releaseSyncLock('background');
    expect(harness.store['cloud-sync-lock']).toBeUndefined();

    await fireHeartbeatAt(harness, BASE + 30_000);

    // The tick noticed the missing lock: no resurrection, alarm cleared.
    expect(harness.store['cloud-sync-lock']).toBeUndefined();
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);
    expect(harness.created).toHaveLength(1); // no re-arm
  });

  it('stops beating when the lock was stolen, without clobbering the thief', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');

    // The heartbeat lapses past LOCK_FRESH_MS (no tick fired in time) and a
    // popup steals the stale lock.
    jest.setSystemTime(new Date(BASE + LOCK_STALE_MS));
    await expect(syncLock.acquireSyncLock('popup')).resolves.toBe(true);

    await fireHeartbeatAt(harness, BASE + LOCK_STALE_MS + 30_000);

    // The late tick must NOT refresh (or overwrite) the popup's lock.
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'popup',
      ts: BASE + LOCK_STALE_MS,
    });
    expect(harness.cleared).toContain(SYNC_LOCK_HEARTBEAT_ALARM);
    expect(harness.created).toHaveLength(1); // no re-arm
  });

  it('ignores alarm events in contexts that never started the heartbeat', async () => {
    // A lock held by the background (e.g. its heartbeat is alive in the
    // service worker); THIS context is a popup whose module instance never
    // claimed the heartbeat.
    harness.store['cloud-sync-lock'] = { owner: 'background', ts: BASE };

    await fireHeartbeatAt(harness, BASE + 30_000);

    // A bystander context neither refreshes nor clears the live worker's
    // heartbeat alarm.
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE,
    });
    expect(harness.created).toHaveLength(0);
    expect(harness.cleared).toHaveLength(0);
  });

  it('drops the claim and clears the alarm at worker boot', async () => {
    await syncLock.acquireSyncLock('background');
    await syncLock.startSyncLockHeartbeat('background');
    harness.cleared.length = 0;
    harness.created.length = 0;

    syncLock.resetSyncLockHeartbeatForBoot();

    expect(harness.cleared).toEqual([SYNC_LOCK_HEARTBEAT_ALARM]);

    // A tick after the reboot finds no claim: the (fresh boot's) stale-alarm
    // event is a no-op and the lock ages out via the normal freshness check.
    await fireHeartbeatAt(harness, BASE + 30_000);
    expect(harness.store['cloud-sync-lock']).toEqual({
      owner: 'background',
      ts: BASE,
    });
    expect(harness.created).toHaveLength(0);
  });

  it('reports no heartbeat when chrome.alarms is unavailable', async () => {
    (globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: (_k: unknown, cb: (r: Record<string, unknown>) => void) =>
            cb({}),
          set: (_o: unknown, cb: () => void) => cb(),
          remove: (_k: unknown, cb: () => void) => cb(),
        },
      },
    };
    await syncLock.acquireSyncLock('background');
    // Still safe: the lock works, only the renewal alarm is unavailable.
    await expect(syncLock.startSyncLockHeartbeat('background')).resolves.toBe(
      false
    );
    expect(harness.created).toHaveLength(0);
  });
});
