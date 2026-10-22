import {
  APP_KEY,
  StorageSimulator,
  installStorageSimulator,
  readEnvelope,
  uninstallStorageSimulator,
} from './storageSimulator';

// The store's action modules import `nanoid`, whose browser build is ESM and
// unparseable by jest; stub it with a deterministic implementation.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

// Search/sort preference persistence (cleanup-and-regression-tests §4.2).
// `sortOption` and `searchFilters` were previously transient: the store held
// them but `partializeAppState` did not, so every restart silently reset the
// user's search filters and sort order. These tests prove both survive a
// SIMULATED restart: `jest.resetModules()` + a fresh `import` rebuilds the
// store singleton, the storage wrapper and the generation trackers — exactly
// what an extension relaunch does — and the fresh store rehydrates from the
// same chrome.storage.local blob the previous instance persisted (the
// StorageSimulator stands in for chrome.storage.local with its documented
// contract, as in storage.multiContext.test.ts).

const sim = new StorageSimulator();
let previousChrome: unknown;

let useAppStore: (typeof import('@/stores/appStore'))['useAppStore'];

const bootFreshStore = async (): Promise<void> => {
  jest.resetModules();
  ({ useAppStore } = await import('@/stores/appStore'));
  await useAppStore.persist.rehydrate(); // settle the import-time hydrate
};

/** Settle the async persist write-back (fake timers + microtask drain). */
const flushPersist = (): Promise<unknown> => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  sim.reset();
  previousChrome = installStorageSimulator(sim);
});

afterEach(() => {
  uninstallStorageSimulator(previousChrome);
  jest.useRealTimers();
});

describe('sortOption + searchFilters persistence across a simulated restart', () => {
  it('writes both fields through partialize and a fresh store instance restores them', async () => {
    // --- Session 1: change the preferences through the store setters. ---
    await bootFreshStore();
    useAppStore.getState().setSortOption('date');
    useAppStore.getState().setSearchFilters({ links: false });
    await flushPersist();

    // The persisted blob (the partialize allow-list) now carries both fields…
    const stored = readEnvelope(sim.peek(APP_KEY)).state;
    expect(stored?.sortOption).toBe('date');
    expect(stored?.searchFilters).toEqual({
      projects: true,
      collections: true,
      links: false,
    });

    // --- Restart: a brand-new store instance over the SAME storage. ---
    await bootFreshStore();

    expect(useAppStore.getState().sortOption).toBe('date');
    expect(useAppStore.getState().searchFilters).toEqual({
      projects: true,
      collections: true,
      links: false,
    });
  });

  it('round-trips partial filter updates without dropping the untoggled keys', async () => {
    await bootFreshStore();
    useAppStore.getState().setSearchFilters({ projects: false });
    await flushPersist();

    await bootFreshStore(); // restart

    expect(useAppStore.getState().searchFilters).toEqual({
      projects: false,
      collections: true,
      links: true,
    });
  });

  it('keeps partialize an allow-list: searchQuery stays transient', async () => {
    await bootFreshStore();
    useAppStore.getState().setSortOption('date');
    useAppStore.getState().setSearchQuery('needle');
    await flushPersist();

    const stored = readEnvelope(sim.peek(APP_KEY)).state;
    expect(stored?.sortOption).toBe('date');
    expect(stored).not.toHaveProperty('searchQuery');
  });

  it('first-run write includes both fields with their defaults', async () => {
    // No blob poked: the import-time hydrate of a fresh install persists the
    // defaults — the new fields must be part of that first write too.
    await bootFreshStore();
    await flushPersist();

    const stored = readEnvelope(sim.peek(APP_KEY)).state;
    expect(stored?.sortOption).toBe('name');
    expect(stored?.searchFilters).toEqual({
      projects: true,
      collections: true,
      links: true,
    });
  });
});
