import { chromeStorageApi } from '@tabspace/shared/stores/storage';

// The store's action modules import `nanoid`, whose browser build is ESM and
// unparseable by jest; stub it with a deterministic implementation. The store
// itself is imported dynamically inside the boot test, after the chrome mock
// is installed, so its import-time persist hydrate exercises the real
// quarantine path against the mock below.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

const STORAGE_KEY = 'tab-manager-storage';
const QUARANTINE_KEY = 'tab-manager-storage.quarantine';

// In-memory chrome.storage.local backed by a Map so tests can assert on the
// last writes (quarantine payloads, key removal).
const backingStore = new Map<string, string>();

const storageGet = jest.fn();
const storageSet = jest.fn();
const storageRemove = jest.fn();

beforeEach(() => {
  backingStore.clear();
  jest.clearAllMocks();
  storageGet.mockImplementation(
    (
      keys: string[] | string | Record<string, unknown>,
      callback: (result: Record<string, string>) => void
    ) => {
      const requested = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
          ? [keys]
          : Object.keys(keys);
      const result: Record<string, string> = {};
      requested.forEach((key) => {
        if (backingStore.has(key)) {
          result[key] = backingStore.get(key) as string;
        }
      });
      callback(result);
    }
  );
  storageSet.mockImplementation(
    (items: Record<string, string>, callback?: () => void) => {
      Object.entries(items).forEach(([key, value]) =>
        backingStore.set(key, value)
      );
      callback?.();
    }
  );
  storageRemove.mockImplementation(
    (keys: string | string[], callback?: () => void) => {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) =>
        backingStore.delete(key)
      );
      callback?.();
    }
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

describe('chromeStorageApi.getItem quarantine', () => {
  it('resolves null, quarantines a corrupt blob, and removes the original key', async () => {
    const corruptBlob = JSON.stringify({
      state: { projects: 'not-an-array', quickLinks: 42 },
      version: 1,
    });
    backingStore.set(STORAGE_KEY, corruptBlob);

    await expect(chromeStorageApi.getItem(STORAGE_KEY)).resolves.toBeNull();

    // Original key removed so the next boot is clean.
    expect(backingStore.has(STORAGE_KEY)).toBe(false);

    // Corrupt blob copied aside (latest wins) with reason + raw payload.
    expect(backingStore.has(QUARANTINE_KEY)).toBe(true);
    const quarantined = JSON.parse(
      backingStore.get(QUARANTINE_KEY) as string
    ) as { quarantinedAt: string; reason: string; raw: string };
    expect(quarantined.raw).toBe(corruptBlob);
    expect(quarantined.reason).toContain('projects');
    expect(typeof quarantined.quarantinedAt).toBe('string');
    expect(Number.isNaN(new Date(quarantined.quarantinedAt).getTime())).toBe(
      false
    );
  });

  it('quarantines unparseable JSON as well', async () => {
    const corruptBlob = '{"state":{"projects":[]},"vers';
    backingStore.set(STORAGE_KEY, corruptBlob);

    await expect(chromeStorageApi.getItem(STORAGE_KEY)).resolves.toBeNull();

    const quarantined = JSON.parse(
      backingStore.get(QUARANTINE_KEY) as string
    ) as { raw: string };
    expect(quarantined.raw).toBe(corruptBlob);
    expect(backingStore.has(STORAGE_KEY)).toBe(false);
  });

  it('passes a valid snapshot through unchanged with no quarantine write', async () => {
    const validBlob = JSON.stringify({
      state: { projects: [{ id: 'p1', name: 'Work' }] },
      version: 1,
    });
    backingStore.set(STORAGE_KEY, validBlob);

    await expect(chromeStorageApi.getItem(STORAGE_KEY)).resolves.toBe(
      validBlob
    );

    expect(backingStore.has(QUARANTINE_KEY)).toBe(false);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('resolves null without any writes when nothing is stored', async () => {
    await expect(chromeStorageApi.getItem(STORAGE_KEY)).resolves.toBeNull();
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

describe('boot with a corrupt stored snapshot', () => {
  it('boots the app store with default projects instead of the corrupt data', async () => {
    const corruptBlob = JSON.stringify({
      state: { projects: 'corrupted-into-a-string', notes: 'nope' },
      version: 1,
    });
    backingStore.set(STORAGE_KEY, corruptBlob);

    // Import the store only after the chrome mock is in place.
    const { useAppStore } = await import('@/stores/appStore');
    const { initialProjects } = await import('@/stores/mockData');

    // Force a settled hydration round so assertions run after the storage
    // load definitively completed (the import-time hydrate quarantined the
    // blob and removed the key; this rehydrate sees a clean load).
    await useAppStore.persist.rehydrate();

    const projects = useAppStore.getState().projects;
    expect(projects).toEqual(initialProjects);
  });
});
