import {
  APP_STATE_STORAGE_KEY,
  createContextStorage,
  parsePersistedEnvelope,
  readEnvelopeGeneration,
  subscribeToStorageChanges,
  type GenerationTracker,
} from '@tabspace/shared/stores/storage';
import {
  APP_KEY,
  StorageSimulator,
  installStorageSimulator,
  makeEnvelope,
  readEnvelope,
  uninstallStorageSimulator,
} from './storageSimulator';

// Generation tracking + merge-on-write tests for the storage wrapper
// (tasks 1.1 / 1.2). Each test creates fresh contexts via createContextStorage
// so trackers never leak between tests; the simulator stands in for
// chrome.storage.local with its documented contract (atomic per-key get/set,
// onChanged firehose, no transactions).

const sim = new StorageSimulator();
let previousChrome: unknown;

beforeEach(() => {
  sim.reset();
  previousChrome = installStorageSimulator(sim);
});

afterEach(() => {
  uninstallStorageSimulator(previousChrome);
});

const project = (id: string, updatedAtMs = 100) => ({
  id,
  name: `name-${id}`,
  collections: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(updatedAtMs).toISOString(),
});

const note = (id: string, content: string, updatedAtMs: number) => ({
  id,
  content,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(updatedAtMs).toISOString(),
});

describe('stateGeneration in the blob schema (task 1.1)', () => {
  it('stamps stateGeneration 1 on the first write and increments after', async () => {
    const ctx = createContextStorage();

    await ctx.storage.setItem(APP_KEY, makeEnvelope({ notes: [] }));
    expect(readEnvelope(sim.peek(APP_KEY)).stateGeneration).toBe(1);

    // A changed state (an identical write is skipped — no-op persists must not
    // bump the generation or fire onChanged).
    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'new', 100)] })
    );
    expect(readEnvelope(sim.peek(APP_KEY)).stateGeneration).toBe(2);
  });

  it('treats legacy blobs without stateGeneration as generation 0', () => {
    expect(
      readEnvelopeGeneration(parsePersistedEnvelope('{"state":{},"version":1}'))
    ).toBe(0);
    expect(readEnvelopeGeneration(parsePersistedEnvelope(null))).toBe(0);
    expect(readEnvelopeGeneration(parsePersistedEnvelope('not-json'))).toBe(0);
  });

  it('getItem observes the stored generation so an uncontested write skips merging', async () => {
    sim.poke(APP_KEY, makeEnvelope({ projects: [project('p-base')] }, 5));
    const ctx = createContextStorage();

    await ctx.storage.getItem(APP_KEY);
    expect(ctx.tracker.observed).toBe(5);

    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p-base', 100), project('p-mine', 200)],
      })
    );
    const stored = readEnvelope(sim.peek(APP_KEY));
    // Observed 5 == stored 5 → no skew → plain write at 6.
    expect(stored.stateGeneration).toBe(6);
    expect(
      (stored.state?.projects as Array<{ id: string }>).map((p) => p.id)
    ).toEqual(['p-base', 'p-mine']);
  });
});

describe('merge-on-write when another context persisted (task 1.2)', () => {
  it('merges the pending snapshot into a moved blob: both contexts’ entities survive', async () => {
    const base = { projects: [project('p-base')], notes: [] };
    sim.poke(APP_KEY, makeEnvelope(base, 2));
    const ctx = createContextStorage();
    await ctx.storage.getItem(APP_KEY); // observes generation 2

    // Another context (popup) persists its own newer snapshot.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        {
          projects: [project('p-base'), project('p-foreign')],
          notes: [note('n-foreign', 'popup', 300)],
        },
        3
      )
    );

    // This context (newtab) persists its stale pending snapshot.
    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p-base'), project('p-mine')],
        notes: [],
      })
    );

    const stored = readEnvelope(sim.peek(APP_KEY));
    expect(stored.stateGeneration).toBe(4);
    expect(
      (stored.state?.projects as Array<{ id: string }>).map((p) => p.id).sort()
    ).toEqual(['p-base', 'p-foreign', 'p-mine']);
    expect(
      (stored.state?.notes as Array<{ id: string }>).map((n) => n.id)
    ).toEqual(['n-foreign']);
  });

  it('breaks write-path id collisions on equal updatedAt in favor of the stored copy', async () => {
    sim.poke(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'stored copy', 250)] }, 1)
    );
    const ctx = createContextStorage();
    await ctx.storage.getItem(APP_KEY);

    // Foreign bump so the wrapper takes the merge path.
    sim.poke(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'stored copy', 250)] }, 2)
    );

    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'pending tie', 250)] })
    );

    const stored = readEnvelope(sim.peek(APP_KEY));
    expect(
      (stored.state?.notes as Array<{ content: string }>)[0]?.content
    ).toBe('stored copy');
  });

  it('lets the pending snapshot win when its entity is strictly newer', async () => {
    sim.poke(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'stored stale', 100)] }, 1)
    );
    const ctx = createContextStorage();
    await ctx.storage.getItem(APP_KEY);
    sim.poke(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'stored stale', 100)] }, 2)
    );

    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({ notes: [note('n1', 'pending fresh', 400)] })
    );

    const stored = readEnvelope(sim.peek(APP_KEY));
    expect(
      (stored.state?.notes as Array<{ content: string }>)[0]?.content
    ).toBe('pending fresh');
  });

  it('retries once after a post-write clobber and still lands the union', async () => {
    sim.poke(
      APP_KEY,
      makeEnvelope({ projects: [project('p-base')], notes: [] }, 1)
    );
    const ctx = createContextStorage();
    await ctx.storage.getItem(APP_KEY); // observed 1

    // Foreign context bumps to gen 2 while we were thinking (write skew).
    sim.poke(
      APP_KEY,
      makeEnvelope(
        { projects: [project('p-base'), project('p-skew')], notes: [] },
        2
      )
    );

    // …and another foreign write clobbers OUR write the moment it lands,
    // simulating the no-CAS race inside the set → verify window.
    sim.afterNextSet = () => {
      sim.poke(
        APP_KEY,
        makeEnvelope(
          { projects: [project('p-base'), project('p-clobber')], notes: [] },
          9
        )
      );
    };

    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p-base'), project('p-mine')],
        notes: [],
      })
    );

    const stored = readEnvelope(sim.peek(APP_KEY));
    // Retry merged the gen-9 clobber with our pending snapshot.
    expect(stored.stateGeneration).toBe(10);
    expect(
      (stored.state?.projects as Array<{ id: string }>).map((p) => p.id).sort()
    ).toEqual(['p-base', 'p-clobber', 'p-mine']);
    expect(ctx.tracker.written).toBe(10);
  });

  it('skips identical-content writes entirely (no generation bump, no onChanged event)', async () => {
    sim.poke(APP_KEY, makeEnvelope({ notes: [note('n1', 'same', 100)] }, 5));
    const ctx = createContextStorage();
    await ctx.storage.getItem(APP_KEY);

    let events = 0;
    const countEvents = () => {
      events += 1;
    };
    sim.onChanged.addListener(countEvents);
    try {
      // Same state, different key order — still content-identical.
      await ctx.storage.setItem(
        APP_KEY,
        makeEnvelope({ notes: [note('n1', 'same', 100)] }, 99)
      );

      const stored = readEnvelope(sim.peek(APP_KEY));
      expect(stored.stateGeneration).toBe(5); // untouched
      expect(events).toBe(0); // no event → no cross-context ping-pong
      expect(ctx.tracker.written).toBeNull(); // we never wrote
    } finally {
      sim.onChanged.removeListener(countEvents);
    }
  });

  it('writes non-envelope values for other keys verbatim (sidebar key passthrough)', async () => {
    const ctx = createContextStorage();
    const sidebarBlob = 'true';

    await ctx.storage.setItem('sidebar-state', sidebarBlob);
    expect(sim.peek('sidebar-state')).toBe('true');

    await expect(ctx.storage.getItem('sidebar-state')).resolves.toBe('true');
    expect(ctx.tracker.observed).toBeNull(); // non-app keys never touch tracking
  });

  it('keeps validation/quarantine scoped to the app key', async () => {
    const ctx = createContextStorage();
    // A bare boolean is valid for the sidebar key (no quarantine)…
    sim.poke('sidebar-state', 'false');
    await expect(ctx.storage.getItem('sidebar-state')).resolves.toBe('false');
    expect(sim.peek('tab-manager-storage.quarantine')).toBeUndefined();

    // …but a corrupt app blob is quarantined on load (§2 behavior preserved).
    sim.poke(
      APP_KEY,
      JSON.stringify({ state: { projects: 'not-an-array' }, version: 1 })
    );
    await expect(ctx.storage.getItem(APP_KEY)).resolves.toBeNull();
    expect(sim.peek(APP_KEY)).toBeUndefined(); // original removed
    expect(sim.peek('tab-manager-storage.quarantine')).toBeDefined();
    expect(ctx.tracker.observed).toBeNull();
  });
});

describe('subscribeToStorageChanges (task 1.4 helper)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const fire = (blob: string) => sim.poke(APP_KEY, blob);

  it('debounces external writes (500 ms trailing) and reports the generation', () => {
    const tracker: GenerationTracker = { observed: null, written: null };
    const seen: number[] = [];
    const detach = subscribeToStorageChanges(
      { onExternalChange: (gen) => seen.push(gen) },
      tracker
    );

    fire(makeEnvelope({ notes: [] }, 2));
    jest.advanceTimersByTime(499);
    expect(seen).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(seen).toEqual([2]);
    expect(tracker.observed).toBe(2);

    detach();
  });

  it('coalesces a burst into one trailing callback', () => {
    const tracker: GenerationTracker = { observed: null, written: null };
    const seen: number[] = [];
    const detach = subscribeToStorageChanges(
      { onExternalChange: (gen) => seen.push(gen) },
      tracker
    );

    fire(makeEnvelope({ notes: [] }, 2));
    jest.advanceTimersByTime(200);
    fire(makeEnvelope({ notes: [] }, 3));
    jest.advanceTimersByTime(200);
    fire(makeEnvelope({ notes: [] }, 4));
    jest.advanceTimersByTime(500);

    expect(seen).toEqual([4]);

    detach();
  });

  it('ignores self-echo events (generation equals the tracker’s last write)', () => {
    const tracker: GenerationTracker = { observed: 1, written: 2 };
    const seen: number[] = [];
    const detach = subscribeToStorageChanges(
      { onExternalChange: (gen) => seen.push(gen) },
      tracker
    );

    fire(makeEnvelope({ notes: [] }, 2)); // our own write echoing back
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([]);

    fire(makeEnvelope({ notes: [] }, 3)); // genuine external write
    jest.advanceTimersByTime(500);
    expect(seen).toEqual([3]);

    detach();
  });

  it('ignores removal events (nothing to rehydrate) and detaches cleanly', () => {
    const tracker: GenerationTracker = { observed: null, written: null };
    const seen: number[] = [];
    const detach = subscribeToStorageChanges(
      { onExternalChange: (gen) => seen.push(gen) },
      tracker
    );

    sim.remove(APP_KEY);
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([]);

    detach();
    fire(makeEnvelope({ notes: [] }, 9));
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });
});

describe('APP_STATE_STORAGE_KEY', () => {
  it('is the persist middleware key', () => {
    expect(APP_STATE_STORAGE_KEY).toBe('tab-manager-storage');
  });
});
