/**
 * PERMANENT multi-context storage regression suite — spec capability
 * `regression-test-suite` (cleanup-and-regression-tests §5.1).
 *
 * One StorageSimulator stands in for chrome.storage.local (atomic per-key
 * get/set, an onChanged firehose, NO transactions — ./storageSimulator.ts
 * documents the exact contract). Each `bootContext()` call is one browser
 * context with its own generation tracker; each fresh app-store module
 * registry (`jest.resetModules()` + re-import) is one full extension
 * runtime, i.e. a simulated popup / newtab / service-worker relaunch.
 *
 * One describe per pinned behavior:
 *   1. interleaved writes converge — no context's committed edit is lost
 *      (spec: "Interleaved writes converge"), both orderings, N ≥ 2
 *   2. rehydrate preserves newer local edits (write path) — a stale writer
 *      never reverts a strictly-newer updatedAt
 *   3. corrupt-snapshot quarantine — invalid blobs are set aside (§2 of
 *      fix-cross-context-data-loss), storage stays loadable, defaults win
 *   4. real app store rehydrate paths — the onChanged → debounced
 *      rehydrate → mergeAppState flow behind the scenarios above, including
 *      the updatedAt tie-break (ties → persisted copy)
 *   5. self-echo guard — a context never re-rehydrates off its own write;
 *      the onChanged cascade is bounded after a single write
 *   6. fresh-runtime boots — deterministic defaults for fresh installs and
 *      the store-level quarantine boot
 *
 * Complements (does not replace) the unit-level suites: storage.generation
 * .test.ts pins wrapper mechanics, mergeAppState.union.test.ts merge
 * semantics, storage.quarantine.test.ts the quarantine path against a plain
 * mock, and searchSortPersistence.test.ts restart persistence.
 */

// The store's action modules import `nanoid`, whose browser build is ESM and
// unparseable by jest; stub it with a deterministic implementation.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

import { resetGenerationTrackingForTests } from '@tabspace/shared/stores/storage';

import {
  APP_KEY,
  StorageSimulator,
  bootContext,
  expectConverged,
  installStorageSimulator,
  makeEnvelope,
  readEnvelope,
  storedGeneration,
  storedQuarantine,
  storedState,
  uninstallStorageSimulator,
} from './storageSimulator';

const sim = new StorageSimulator();
let previousChrome: unknown;

beforeEach(() => {
  sim.reset();
  previousChrome = installStorageSimulator(sim);
});

afterEach(() => {
  uninstallStorageSimulator(previousChrome);
});

// --- entity factories (deterministic timestamps; `content` is the usual
// assertion surface) and views over the stored blob -------------------------

const note = (id: string, content: string, updatedAtMs: number) => ({
  id,
  content,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(updatedAtMs).toISOString(),
});

const project = (id: string, updatedAtMs = 100) => ({
  id,
  name: `name-${id}`,
  collections: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(updatedAtMs).toISOString(),
});

const storedNotes = (): Array<{ id: string; content: string }> =>
  (storedState(sim)?.notes as Array<{ id: string; content: string }>) ?? [];

const storedProjects = (): Array<{ id: string }> =>
  (storedState(sim)?.projects as Array<{ id: string }>) ?? [];

// ---------------------------------------------------------------------------
// 1. Interleaved writes converge (spec: "Interleaved writes converge")
// ---------------------------------------------------------------------------

describe('interleaved writes converge (spec: Interleaved writes converge)', () => {
  // The shared interleave pattern: two contexts boot from one blob, then
  // write in the given order — the first context commits two edits, the
  // second commits one between them. Every write after the first observes a
  // moved generation, so the merge path runs for each of them.
  const runTwoContextInterleave = async (first: 'popup' | 'newtab') => {
    const second = first === 'popup' ? 'newtab' : 'popup';

    // Common state both contexts booted from.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        { projects: [project('p1')], notes: [note('n0', 'base', 10)] },
        1
      )
    );

    const firstCtx = await bootContext();
    const secondCtx = await bootContext();

    // First context: observed 1 == stored 1 → plain write (generation 2).
    await firstCtx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p1')],
        notes: [
          note('n0', 'base', 10),
          note(`n-${first}`, `${first} edit`, 100),
        ],
      })
    );
    expect(storedGeneration(sim)).toBe(2);

    // Second context never saw that write: its stale persist must detect
    // the generation move and MERGE (generation 3), not clobber.
    await secondCtx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p1')],
        notes: [
          note('n0', 'base', 10),
          note(`n-${second}`, `${second} edit`, 200),
        ],
      })
    );

    // First context persists a second edit while still stale → merge again.
    await firstCtx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p1')],
        notes: [
          note('n0', 'base', 10),
          note(`n-${first}`, `${first} edit`, 100),
          note(`n-${first}-2`, `${first} edit 2`, 300),
        ],
      })
    );

    // Convergence: exactly the committed entity set survives — no lost
    // edits, no silent clobber, in either write order.
    expectConverged(sim, {
      projects: [{ id: 'p1' }],
      notes: [
        { id: 'n0', content: 'base' },
        { id: `n-${first}`, content: `${first} edit` },
        { id: `n-${first}-2`, content: `${first} edit 2` },
        { id: `n-${second}`, content: `${second} edit` },
      ],
    });
    expect(storedGeneration(sim)).toBe(4);
  };

  it('popup + newtab interleaved edits ALL survive in storage (popup writes first)', async () => {
    // Spec: "Interleaved writes converge" — the final stored state contains
    // both contexts' edits.
    await runTwoContextInterleave('popup');
  });

  it('newtab + popup interleaved edits ALL survive in storage (newtab writes first)', async () => {
    // Spec: "Interleaved writes converge" — the mirror ordering converges to
    // the same committed set (the merge is order-independent).
    await runTwoContextInterleave('newtab');
  });

  it('three contexts writing round-robin all converge (N=3)', async () => {
    // Spec: "Interleaved writes converge" generalized to N > 2: every
    // context's committed edits survive six interleaved writes.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        { projects: [project('p1')], notes: [note('n0', 'base', 10)] },
        1
      )
    );

    const contexts = await Promise.all([
      bootContext(),
      bootContext(),
      bootContext(),
    ]);
    const ids = ['n-a', 'n-b', 'n-c'];

    // Round 1: each context adds its own note. Round 2: each adds one more
    // on top of its (stale) view — later writers always observe a moved
    // generation and must merge.
    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < contexts.length; i += 1) {
        const mine = round === 0 ? [ids[i]] : [ids[i], `${ids[i]}-2`];
        await contexts[i].storage.setItem(
          APP_KEY,
          makeEnvelope({
            projects: [project('p1')],
            notes: [
              note('n0', 'base', 10),
              ...mine.map((id, k) => note(id, `edit ${id}`, 100 + k)),
            ],
          })
        );
      }
    }

    expectConverged(sim, {
      projects: [{ id: 'p1' }],
      notes: [
        { id: 'n0', content: 'base' },
        { id: 'n-a', content: 'edit n-a' },
        { id: 'n-a-2', content: 'edit n-a-2' },
        { id: 'n-b', content: 'edit n-b' },
        { id: 'n-b-2', content: 'edit n-b-2' },
        { id: 'n-c', content: 'edit n-c' },
        { id: 'n-c-2', content: 'edit n-c-2' },
      ],
    });
    expect(storedGeneration(sim)).toBe(7); // seed + exactly 6 content writes
  });
});

// ---------------------------------------------------------------------------
// 2. Rehydrate preserves newer local edits — write-path merge direction
// (spec: "Rehydrate preserves newer local edits")
// ---------------------------------------------------------------------------

describe('rehydrate preserves newer local edits (write path)', () => {
  it('a background pull does not revert in-flight popup edits (newer updatedAt wins)', async () => {
    // Spec: "Rehydrate preserves newer local edits" — the popup's strictly
    // newer field values survive a foreign snapshot landing mid-flight.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        { projects: [project('p1')], notes: [note('n1', 'base', 10)] },
        1
      )
    );
    const popup = await bootContext();

    // The user edits n1 in the popup (in memory, not yet persisted)…
    const pendingPopupState = {
      projects: [project('p1')],
      notes: [note('n1', 'in-flight popup edit', 500)],
    };

    // …while the background service worker pulls from the server and writes
    // a snapshot containing an OLDER copy of n1 plus a server-only project.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        {
          projects: [project('p1'), project('p-server', 400)],
          notes: [note('n1', 'background pull', 50)],
        },
        2
      )
    );

    // The popup persists: the merge must keep its newer note content AND the
    // background's server-only project.
    await popup.storage.setItem(APP_KEY, makeEnvelope(pendingPopupState));

    expect(storedNotes().find((n) => n.id === 'n1')?.content).toBe(
      'in-flight popup edit'
    );
    expect(storedProjects().map((p) => p.id)).toEqual(['p1', 'p-server']);
    expect(storedGeneration(sim)).toBe(3);
  });

  it('a stale writer does not clobber a foreign context’s strictly newer edit (reverse order)', async () => {
    // Spec: "Rehydrate preserves newer local edits" — mirror direction: the
    // stale pending copy must lose to the persisted strictly-newer edit.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        { projects: [project('p1')], notes: [note('n1', 'base', 10)] },
        1
      )
    );
    const popup = await bootContext();

    // Another context persists a strictly newer n1 while popup holds its
    // stale snapshot.
    sim.poke(
      APP_KEY,
      makeEnvelope(
        {
          projects: [project('p1')],
          notes: [note('n1', 'background newer', 500)],
        },
        2
      )
    );

    await popup.storage.setItem(
      APP_KEY,
      makeEnvelope({
        projects: [project('p1')],
        notes: [note('n1', 'stale popup copy', 10)],
      })
    );

    expect(storedNotes().find((n) => n.id === 'n1')?.content).toBe(
      'background newer'
    );
    // The merged result is content-identical to what is stored, so the
    // wrapper skips the write entirely (no generation bump, no onChanged) —
    // the stale writer simply converges instead of re-publishing.
    expect(storedGeneration(sim)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Corrupt-snapshot quarantine (§2 of fix-cross-context-data-loss:
// corrupt blobs are set aside, never loaded, storage stays usable)
// ---------------------------------------------------------------------------

describe('corrupt-snapshot quarantine (corrupt blobs set aside, storage stays loadable)', () => {
  it('quarantines a structurally invalid snapshot, keeps storage loadable, defaults win', async () => {
    // Corrupt-snapshot quarantine: a context that loads a corrupt blob must
    // (a) not load it, (b) find it set aside under the quarantine key with
    // its reason, (c) leave storage usable for the next contexts (defaults
    // or last-good state win).
    const corruptBlob = JSON.stringify({
      state: { projects: 'not-an-array', notes: 42 },
      version: 1,
    });
    sim.poke(APP_KEY, corruptBlob);

    const ctxA = await bootContext();
    expect(ctxA.loaded).toBeNull(); // corrupt blob never reaches the store
    expect(ctxA.tracker.observed).toBeNull();

    // Set aside, not wiped: raw payload + reason stay recoverable.
    const quarantined = storedQuarantine(sim);
    expect(quarantined?.raw).toBe(corruptBlob);
    expect(quarantined?.reason).toContain('projects');
    expect(typeof quarantined?.quarantinedAt).toBe('string');
    expect(sim.peek(APP_KEY)).toBeUndefined(); // removed from the live key

    // Storage stays loadable: a fresh context boots clean and the default
    // state it writes back lands at generation 1…
    const ctxB = await bootContext();
    expect(ctxB.loaded).toBeNull(); // defaults boot
    await ctxB.storage.setItem(
      APP_KEY,
      makeEnvelope({ projects: [project('p1')], notes: [] })
    );
    expect(storedGeneration(sim)).toBe(1);

    // …and a third context reads exactly that.
    const ctxC = await bootContext();
    expect(ctxC.loaded).not.toBeNull();
    expect(readEnvelope(ctxC.loaded ?? undefined).stateGeneration).toBe(1);
  });

  it('quarantines unparseable JSON the same way', async () => {
    // Corrupt-snapshot quarantine: the truncated-JSON class.
    const corruptBlob = '{"state":{"projects":[]},"vers';
    sim.poke(APP_KEY, corruptBlob);

    const ctx = await bootContext();
    expect(ctx.loaded).toBeNull();
    expect(storedQuarantine(sim)?.raw).toBe(corruptBlob);
    expect(sim.peek(APP_KEY)).toBeUndefined();
  });

  it('a corrupt generation field does NOT quarantine: blob stays loadable, generation restarts monotonic', async () => {
    // Corrupt-snapshot quarantine, "bad generation" class: an invalid
    // stateGeneration makes the envelope read as legacy generation 0 but the
    // blob itself is structurally fine — it must LOAD, and the next write
    // must land at generation 1 (monotonic from the corrected base).
    sim.poke(
      APP_KEY,
      JSON.stringify({
        state: { notes: [note('n0', 'base', 10)] },
        version: 1,
        stateGeneration: 'garbage',
      })
    );

    const ctx = await bootContext();
    expect(ctx.loaded).not.toBeNull(); // loaded, not quarantined
    expect(storedQuarantine(sim)).toBeUndefined();
    expect(ctx.tracker.observed).toBe(0); // invalid generation → legacy 0

    await ctx.storage.setItem(
      APP_KEY,
      makeEnvelope({
        notes: [note('n0', 'base', 10), note('n1', 'edit', 50)],
      })
    );
    const stored = readEnvelope(sim.peek(APP_KEY));
    expect(stored.stateGeneration).toBe(1); // monotonic restart
    expect(
      (stored.state?.notes as Array<{ id: string }>).map((n) => n.id)
    ).toEqual(['n0', 'n1']);
  });
});

// ---------------------------------------------------------------------------
// 4. Real app store over the simulator: the onChanged → debounced rehydrate
// → mergeAppState flow behind scenarios 1–2 (spec: "Rehydrate preserves
// newer local edits"), plus the self-echo guard (scenario 5)
// ---------------------------------------------------------------------------

describe('real app store: onChanged rehydration through the merge path', () => {
  let useAppStore: (typeof import('@/stores/appStore'))['useAppStore'];

  const baselineBlob = () =>
    makeEnvelope(
      {
        projects: [project('p1')],
        notes: [note('n1', 'base', 10)],
        todos: [],
        tasks: [],
        quickLinks: [],
      },
      1
    );

  beforeAll(async () => {
    jest.useFakeTimers();
    installStorageSimulator(sim);

    // Seed the blob BEFORE importing the store so the import-time hydrate
    // loads it (boot mode: persisted wins wholesale over mock defaults).
    sim.poke(APP_KEY, baselineBlob());

    ({ useAppStore } = await import('@/stores/appStore'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // Clean slate for every test: wipe in-memory entity lists left by the
  // previous test (the write-back lands on the cleared backing store), then
  // re-seed the baseline blob and let the debounced rehydrate restore a clean
  // store from storage — the same path under test.
  beforeEach(async () => {
    sim.reset();
    resetGenerationTrackingForTests();
    useAppStore.setState({
      notes: [],
      projects: [],
      todos: [],
      tasks: [],
      quickLinks: [],
      taskTemplates: [],
      pomodoroSessions: [],
      activeProjectId: null,
    });
    await jest.advanceTimersByTimeAsync(0); // settle the wipe write-back
    sim.poke(APP_KEY, baselineBlob()); // baseline at generation 1
    await jest.advanceTimersByTimeAsync(500); // debounced rehydrate
    await useAppStore.persist.rehydrate(); // settle any in-flight merge
  });

  describe('rehydrate preserves newer local edits (spec scenario, store level)', () => {
    it('merges a background write without reverting newer local edits, and converges (no ping-pong)', async () => {
      // Spec: "Rehydrate preserves newer local edits" — the onChanged-driven
      // rehydrate keeps the strictly-newer local field values AND publishes
      // the union; identical rehydrates stop the cascade.
      const baseGen = storedGeneration(sim) ?? 0;

      // In-flight local edit — strictly newer updatedAt than anything stored.
      useAppStore.getState().updateNote('n1', { content: 'local edit' });
      await jest.advanceTimersByTimeAsync(0); // flush the persist write-back
      expect(storedGeneration(sim)).toBe(baseGen + 1);
      expect(storedNotes().find((n) => n.id === 'n1')?.content).toBe(
        'local edit'
      );

      // The background worker pulls and persists a snapshot with an OLDER n1
      // plus a server-only project.
      sim.poke(
        APP_KEY,
        makeEnvelope(
          {
            projects: [project('p1'), project('p-server', 400)],
            notes: [note('n1', 'background pull', 50)],
            todos: [],
            tasks: [],
            quickLinks: [],
          },
          baseGen + 2
        )
      );

      // 500 ms trailing debounce → rehydrate through mergeAppState (union).
      await jest.advanceTimersByTimeAsync(500);

      const state = useAppStore.getState();
      // Local newer edit NOT reverted…
      expect(state.notes.find((n) => n.id === 'n1')?.content).toBe(
        'local edit'
      );
      // …and the background's new project merged in (not a wholesale replace).
      expect(state.projects.map((p) => p.id)).toContain('p-server');

      // The rehydrate write-back published the union to storage.
      expect(storedNotes().find((n) => n.id === 'n1')?.content).toBe(
        'local edit'
      );
      expect(storedProjects().map((p) => p.id)).toContain('p-server');

      // Convergence: advancing several debounce windows must NOT bump the
      // generation again — rehydrates of identical content are skipped by the
      // storage wrapper, so contexts cannot ping-pong writes forever.
      await jest.advanceTimersByTimeAsync(3000);
      expect(storedGeneration(sim)).toBe(baseGen + 3);
    });

    it('keeps locally-created entities that the incoming snapshot does not have', async () => {
      // Spec: "Rehydrate preserves newer local edits" — the union must also
      // keep locally-created entities a foreign snapshot predates.
      useAppStore.setState({
        notes: [
          ...useAppStore.getState().notes,
          {
            id: 'n-newtab-local',
            title: 'Brand new',
            content: 'created locally',
            color: '#ffffff',
            createdAt: new Date(600),
            updatedAt: new Date(600),
            isPinned: false,
          },
        ],
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(storedNotes().map((n) => n.id)).toContain('n-newtab-local');

      // Another context persists a snapshot that predates the creation.
      sim.poke(
        APP_KEY,
        makeEnvelope(
          {
            projects: [project('p1')],
            notes: [note('n1', 'base edited elsewhere', 20)],
            todos: [],
            tasks: [],
            quickLinks: [],
          },
          9
        )
      );
      await jest.advanceTimersByTimeAsync(500);

      const state = useAppStore.getState();
      // Local-only creation survived the rehydrate…
      expect(state.notes.find((n) => n.id === 'n-newtab-local')?.content).toBe(
        'created locally'
      );
      // …and the remote edit to the shared note arrived (persisted copy newer).
      expect(state.notes.find((n) => n.id === 'n1')?.content).toBe(
        'base edited elsewhere'
      );
      // Union published back to storage.
      expect(storedNotes().map((n) => n.id)).toContain('n-newtab-local');
    });

    it('breaks an updatedAt tie in favor of the persisted copy through the rehydrate', async () => {
      // Spec: "Rehydrate preserves newer local edits" — tie-break half: a
      // local edit with an EQUAL updatedAt must lose to the persisted copy
      // (only strictly-newer local edits are protected).
      const baseGen = storedGeneration(sim) ?? 0;

      // Local edit of n1 keeping the stored copy's updatedAt (a tie).
      const localCopy = useAppStore.getState().notes.find((n) => n.id === 'n1');
      if (!localCopy) throw new Error('baseline note missing');
      useAppStore.setState({
        notes: [{ ...localCopy, content: 'local tie edit' }],
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(storedGeneration(sim)).toBe(baseGen + 1);

      // Another context persists a DIFFERENT edit of n1 with the SAME
      // updatedAt, bumping the generation.
      sim.poke(
        APP_KEY,
        makeEnvelope(
          {
            projects: [project('p1')],
            notes: [note('n1', 'persisted tie', 10)],
            todos: [],
            tasks: [],
            quickLinks: [],
          },
          baseGen + 2
        )
      );
      await jest.advanceTimersByTimeAsync(500); // debounced rehydrate

      // Tie → the persisted copy wins in the merged store state…
      expect(
        useAppStore.getState().notes.find((n) => n.id === 'n1')?.content
      ).toBe('persisted tie');
      // …and is what storage now holds (the union write-back).
      expect(storedNotes().find((n) => n.id === 'n1')?.content).toBe(
        'persisted tie'
      );
      expect(storedGeneration(sim)).toBe(baseGen + 3);
    });
  });

  describe('self-echo guard bounds the onChanged cascade', () => {
    it('a single write rehydrates at most once and never loops; an external write cascades at most twice, then silence', async () => {
      // Self-echo guard: after ONE write the context must not re-rehydrate
      // off its own write in a loop — the number of rehydrates stays bounded
      // and the generation stops moving (no ping-pong).
      const baseGen = storedGeneration(sim) ?? 0;
      const rehydrateSpy = jest.spyOn(useAppStore.persist, 'rehydrate');
      try {
        // Drain the scaffolding's residual echo rehydrate first; every
        // assertion below measures DELTAS from this settled point.
        await jest.advanceTimersByTimeAsync(1000);
        const settledCount = rehydrateSpy.mock.calls.length;
        const settledGen = storedGeneration(sim) ?? baseGen;

        // One local write…
        useAppStore.getState().updateNote('n1', { content: 'solo edit' });
        await jest.advanceTimersByTimeAsync(0); // write-back (settledGen + 1)
        expect(storedGeneration(sim)).toBe(settledGen + 1);

        // …must not cascade: at most one echo-driven rehydrate, and the
        // generation stays put across several debounce windows.
        await jest.advanceTimersByTimeAsync(2500);
        expect(
          rehydrateSpy.mock.calls.length - settledCount
        ).toBeLessThanOrEqual(1);
        expect(storedGeneration(sim)).toBe(settledGen + 1);

        // One external write cascades at most twice (its own rehydrate plus
        // at most one echo of the union write-back), then goes silent.
        const afterLocalCount = rehydrateSpy.mock.calls.length;
        sim.poke(
          APP_KEY,
          makeEnvelope(
            {
              projects: [project('p1'), project('p-server', 400)],
              notes: [note('n1', 'background pull', 50)],
              todos: [],
              tasks: [],
              quickLinks: [],
            },
            baseGen + 2
          )
        );
        await jest.advanceTimersByTimeAsync(2500);
        expect(
          rehydrateSpy.mock.calls.length - afterLocalCount
        ).toBeLessThanOrEqual(2);
        // The union was published and the newer local edit survived.
        expect(
          useAppStore.getState().notes.find((n) => n.id === 'n1')?.content
        ).toBe('solo edit');
        expect(useAppStore.getState().projects.map((p) => p.id)).toContain(
          'p-server'
        );

        // Silence: further debounce windows change nothing at all.
        await jest.advanceTimersByTimeAsync(2500);
        expect(
          rehydrateSpy.mock.calls.length - afterLocalCount
        ).toBeLessThanOrEqual(2);
        expect(storedGeneration(sim)).toBe(settledGen + 3);
      } finally {
        rehydrateSpy.mockRestore();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Fresh-runtime boots (jest.resetModules per boot = one relaunch each):
// deterministic defaults (spec: deterministic defaults for fresh installs)
// and the store-level quarantine boot
// ---------------------------------------------------------------------------

describe('fresh-runtime boots (deterministic defaults + store-level quarantine)', () => {
  let bootSim: StorageSimulator;

  beforeEach(() => {
    jest.useFakeTimers();
    // Fresh simulator per runtime: each boot gets its own storage event
    // channel, exactly like a separate extension process relaunch.
    bootSim = new StorageSimulator();
    installStorageSimulator(bootSim);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('two fresh runtimes over empty storage converge on byte-identical default state', async () => {
    // Deterministic defaults: two contexts starting from empty storage must
    // end up with identical default state — fixed mock IDs and a fixed
    // timestamp, so no nanoid/new Date() divergence between contexts.
    jest.resetModules();
    const { useAppStore: store1 } = await import('@/stores/appStore');
    const { INITIAL_PROJECT_ID } = await import('@/stores/mockData');
    await store1.persist.rehydrate();
    await jest.advanceTimersByTimeAsync(0); // flush the first-run write-back
    const blob1 = bootSim.peek(APP_KEY);
    const projects1 = store1.getState().projects;
    expect(blob1).toBeDefined();

    // Runtime 2: empty storage again, brand-new module registry.
    const sim2 = new StorageSimulator();
    installStorageSimulator(sim2);
    jest.resetModules();
    const { useAppStore: store2 } = await import('@/stores/appStore');
    await store2.persist.rehydrate();
    await jest.advanceTimersByTimeAsync(0);
    const blob2 = sim2.peek(APP_KEY);

    // Byte-identical first writes — the strongest determinism statement.
    expect(blob2).toBe(blob1);
    const defaults = readEnvelope(blob2).state as {
      projects?: Array<Record<string, unknown>>;
    };
    expect(defaults.projects).toEqual([
      expect.objectContaining({
        id: INITIAL_PROJECT_ID,
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ]);
    // In-memory defaults match too, including the derived active project.
    expect(store2.getState().projects).toEqual(projects1);
    expect(store2.getState().activeProjectId).toBe(INITIAL_PROJECT_ID);
  });

  it('a corrupt snapshot boots on deterministic defaults and storage stays writable (store-level quarantine)', async () => {
    // Completes the corrupt-snapshot quarantine scenario at store level:
    // defaults win (never the corrupt data), the corrupt blob is set aside,
    // and the next real write persists cleanly.
    const corrupt = JSON.stringify({
      state: { projects: 'corrupted', notes: 'nope' },
      version: 1,
    });
    bootSim.poke(APP_KEY, corrupt);

    jest.resetModules();
    const { useAppStore: store } = await import('@/stores/appStore');
    const { initialProjects, INITIAL_PROJECT_ID } =
      await import('@/stores/mockData');
    await store.persist.rehydrate(); // settles the boot load (quarantine ran at import)
    await jest.advanceTimersByTimeAsync(0);

    expect(store.getState().projects).toEqual(initialProjects); // defaults win
    expect(storedQuarantine(bootSim)?.raw).toBe(corrupt);
    // The corrupt payload is gone from the live key — which now holds the
    // deterministic defaults the first-run write-back published.
    expect(bootSim.peek(APP_KEY)).not.toBe(corrupt);
    const liveState = readEnvelope(bootSim.peek(APP_KEY)).state as {
      projects?: Array<Record<string, unknown>>;
    };
    expect(liveState.projects).toEqual([
      expect.objectContaining({ id: INITIAL_PROJECT_ID }),
    ]);

    // Storage is writable again: the next real edit persists.
    const baseGen = storedGeneration(bootSim) ?? 0;
    expect(baseGen).toBeGreaterThanOrEqual(1); // first-run defaults write-back
    store.setState({ isDarkMode: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(storedGeneration(bootSim)).toBe(baseGen + 1);
    expect(readEnvelope(bootSim.peek(APP_KEY)).state?.isDarkMode).toBe(true);
  });
});
