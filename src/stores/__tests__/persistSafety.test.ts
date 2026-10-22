import {
  PERSIST_SKIPPED_SENTINEL,
  getPersistSkipCount,
  persistSafeStorageAdapter,
  resetPersistSkipCountForTests,
} from '@/stores/persistSafety';
import { partializeAppState } from '@/stores/appStore';
import type { AppState } from '@/stores/types';

// appStore's action modules import `nanoid`, whose browser build is ESM and
// unparseable by jest; stub it with a deterministic implementation.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

const STORAGE_KEY = 'tab-manager-storage';

const storageGet = jest.fn();
const storageSet = jest.fn();
const storageRemove = jest.fn();

beforeEach(() => {
  resetPersistSkipCountForTests();
  jest.clearAllMocks();
  // Safe defaults so unawaited chrome callbacks never hang a test.
  storageGet.mockImplementation(
    (_keys: string[], callback: (result: Record<string, string>) => void) =>
      callback({})
  );
  storageSet.mockImplementation(
    (_items: Record<string, string>, callback?: () => void) => callback?.()
  );
  storageRemove.mockImplementation((_keys: string[], callback?: () => void) =>
    callback?.()
  );
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: { get: storageGet, set: storageSet, remove: storageRemove },
    },
  };
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('partializeAppState failure paths', () => {
  it('returns null (not {}) for invalid state so the write can be skipped', () => {
    expect(partializeAppState(null)).toBeNull();
    expect(partializeAppState(undefined)).toBeNull();
    expect(partializeAppState('junk' as unknown as AppState)).toBeNull();
  });

  it('returns null when reading state throws, and the envelope matches the skip sentinel', () => {
    const throwingState = {} as AppState;
    Object.defineProperty(throwingState, 'projects', {
      get() {
        throw new Error('projects getter exploded');
      },
      configurable: true,
    });

    const snapshot = partializeAppState(throwingState);
    expect(snapshot).toBeNull();

    // Mirrors createJSONStorage.setItem: JSON.stringify({state, version})
    // (zustand 4.5.7 serializes `{state, version}` in that key order) with
    // the store version 1 — exactly the string persistSafeStorageAdapter
    // recognizes and skips.
    expect(PERSIST_SKIPPED_SENTINEL).toBe('{"state":null,"version":1}');
    expect(JSON.stringify({ state: snapshot, version: 1 })).toBe(
      PERSIST_SKIPPED_SENTINEL
    );
  });

  it('still returns the persistable snapshot on the happy path', () => {
    const snapshot = partializeAppState({
      projects: [],
      notes: [],
      todos: [],
      tasks: [],
    } as unknown as AppState);
    expect(snapshot).not.toBeNull();
    expect(snapshot.projects).toEqual([]);
  });
});

describe('persistSafeStorageAdapter', () => {
  it('skips the write for the sentinel and records the skip', async () => {
    const before = getPersistSkipCount();

    await persistSafeStorageAdapter.setItem(
      STORAGE_KEY,
      PERSIST_SKIPPED_SENTINEL
    );

    expect(storageSet).not.toHaveBeenCalled();
    expect(getPersistSkipCount()).toBe(before + 1);
  });

  it('writes values that merely resemble the sentinel (exact match only)', async () => {
    const nearMiss = JSON.stringify({ state: null, version: 2 });
    expect(nearMiss).not.toBe(PERSIST_SKIPPED_SENTINEL);

    await persistSafeStorageAdapter.setItem(STORAGE_KEY, nearMiss);

    expect(storageSet).toHaveBeenCalledWith(
      { [STORAGE_KEY]: nearMiss },
      expect.any(Function)
    );
    expect(getPersistSkipCount()).toBe(0);
  });

  it('delegates normal values to chrome.storage.local.set (stamping stateGeneration)', async () => {
    const value = JSON.stringify({ state: { projects: [] }, version: 1 });

    await persistSafeStorageAdapter.setItem(STORAGE_KEY, value);

    // The safe adapter passes through to chromeStorageApi, which now stamps
    // stateGeneration on the app-state envelope on its way into storage
    // (first write → 1; see storage.generation.test.ts).
    expect(storageSet).toHaveBeenCalledWith(
      {
        [STORAGE_KEY]: JSON.stringify({
          state: { projects: [] },
          version: 1,
          stateGeneration: 1,
        }),
      },
      expect.any(Function)
    );
    expect(getPersistSkipCount()).toBe(0);
  });

  it('delegates getItem and removeItem unchanged', async () => {
    storageGet.mockImplementation(
      (_keys: string[], callback: (result: Record<string, string>) => void) =>
        callback({
          [STORAGE_KEY]: JSON.stringify({ state: {}, version: 1 }),
        })
    );
    storageRemove.mockImplementation((_keys: string[], callback?: () => void) =>
      callback?.()
    );

    await expect(persistSafeStorageAdapter.getItem(STORAGE_KEY)).resolves.toBe(
      JSON.stringify({ state: {}, version: 1 })
    );

    await persistSafeStorageAdapter.removeItem(STORAGE_KEY);
    expect(storageRemove).toHaveBeenCalledWith(
      [STORAGE_KEY],
      expect.any(Function)
    );
  });
});
