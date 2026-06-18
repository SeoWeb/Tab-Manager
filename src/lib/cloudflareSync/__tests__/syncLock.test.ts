import {
  acquireSyncLock,
  releaseSyncLock,
  isSyncLockedByOther,
  LOCK_FRESH_MS,
} from '../syncLock';

/**
 * In-memory chrome.storage.local mock. chrome.storage stores structured values
 * (the sync client writes objects, not strings), so we keep them as-is.
 */
function installChromeStorage(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
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

describe('cloud sync advisory lock', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-06-16T12:00:00Z') });
    store = installChromeStorage();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('acquires when free', async () => {
    await expect(acquireSyncLock('popup')).resolves.toBe(true);
    expect(store['cloud-sync-lock']).toEqual({
      owner: 'popup',
      ts: Date.now(),
    });
  });

  it('blocks a different owner while fresh', async () => {
    await acquireSyncLock('popup');
    await expect(acquireSyncLock('background')).resolves.toBe(false);
    // The fresh owner keeps the lock.
    expect((store['cloud-sync-lock'] as { owner: string }).owner).toBe('popup');
  });

  it('lets the same owner re-acquire', async () => {
    await acquireSyncLock('popup');
    await expect(acquireSyncLock('popup')).resolves.toBe(true);
  });

  it('can be stolen once it goes stale', async () => {
    await acquireSyncLock('popup');
    jest.setSystemTime(
      new Date('2026-06-16T12:00:00Z').getTime() + LOCK_FRESH_MS + 1000
    );
    await expect(acquireSyncLock('background')).resolves.toBe(true);
    expect((store['cloud-sync-lock'] as { owner: string }).owner).toBe(
      'background'
    );
  });

  it('releases only its own lock', async () => {
    await acquireSyncLock('popup');
    // background tries to release a lock it does not own -> no-op.
    await releaseSyncLock('background');
    expect(store['cloud-sync-lock']).toBeDefined();
    // popup releases its own.
    await releaseSyncLock('popup');
    expect(store['cloud-sync-lock']).toBeUndefined();
  });

  it('reports isSyncLockedByOther accurately', async () => {
    await acquireSyncLock('popup');
    await expect(isSyncLockedByOther('background')).resolves.toBe(true);
    await expect(isSyncLockedByOther('popup')).resolves.toBe(false);
  });

  it('reports unlocked once stale', async () => {
    await acquireSyncLock('popup');
    jest.setSystemTime(
      new Date('2026-06-16T12:00:00Z').getTime() + LOCK_FRESH_MS + 1
    );
    await expect(isSyncLockedByOther('background')).resolves.toBe(false);
  });
});
