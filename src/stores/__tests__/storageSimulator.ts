/**
 * Two-context chrome.storage.local simulator (fix-cross-context-data-loss
 * §1.6). Models EXACTLY the three observable chrome.storage behaviors the
 * generation-checked write design relies on — and nothing more:
 *
 *  1. Atomic get/set PER KEY — a `get` returns the value from the last
 *     completed `set`; a `set` replaces the whole value for that key.
 *  2. An `onChanged` firehose — every completed `set`/`remove` notifies every
 *     registered listener with `{ [key]: { oldValue, newValue } }` for the
 *     `local` area (removals carry `newValue: undefined`).
 *  3. NO transactions / NO compare-and-swap — a read-modify-write that spans
 *     a `get` + `set` can interleave with another context's `set` between the
 *     two calls; the last writer wins at the key level. This is precisely the
 *     race the generation counter + merge-on-write exists to survive.
 *
 * Deliberately NOT modeled: quota errors, cross-process serialization timing,
 * the `sync` storage area, and write callbacks that never fire (chrome can
 * hang; the simulator always delivers). Tests that need a write to be
 * clobbered inside the read-modify-write window can use `afterNextSet` to
 * inject a foreign write at that exact point.
 *
 * The permanent multi-context regression suite (storage.multiContext.test.ts,
 * spec capability `regression-test-suite`) builds on this module; the helpers
 * at the bottom generalize context bootstrapping (`bootContext`), stored-blob
 * inspection (`storedState` / `storedGeneration` / `storedQuarantine`) and
 * the convergence assertion (`expectConverged`).
 */

import type { StateStorage } from 'zustand/middleware';
import {
  createContextStorage,
  SNAPSHOT_QUARANTINE_KEY,
  type GenerationTracker,
} from '@tabspace/shared/stores/storage';

type ChangeRecord = { oldValue?: string; newValue?: string };
type StorageChangeListener = (
  changes: Record<string, ChangeRecord>,
  areaName: string
) => void;

export class StorageSimulator {
  private backing = new Map<string, string>();
  private listeners = new Set<StorageChangeListener>();

  /**
   * Test hook: when set, invoked synchronously with (key, value) right after
   * the next `set` delivers its callback — i.e. inside the wrapper's
   * get → set → verify window. Use it to simulate another context winning a
   * write race. Auto-clears after one invocation.
   */
  afterNextSet: ((key: string, value: string) => void) | null = null;

  // chrome.storage.local.get signature
  get = (
    keys: string[] | string | Record<string, unknown>,
    callback: (result: Record<string, unknown>) => void
  ): void => {
    const requested = Array.isArray(keys)
      ? keys
      : typeof keys === 'string'
        ? [keys]
        : Object.keys(keys);
    const result: Record<string, string> = {};
    requested.forEach((key) => {
      if (this.backing.has(key)) result[key] = this.backing.get(key) as string;
    });
    callback(result);
  };

  // chrome.storage.local.set signature
  set = (items: Record<string, string>, callback?: () => void): void => {
    const changes: Record<string, ChangeRecord> = {};
    Object.entries(items).forEach(([key, value]) => {
      const oldValue = this.backing.get(key);
      this.backing.set(key, value);
      changes[key] = { oldValue, newValue: value };
    });
    callback?.();
    this.firehose(changes);
    if (this.afterNextSet) {
      const hook = this.afterNextSet;
      this.afterNextSet = null;
      hook(Object.keys(items)[0] ?? '', String(Object.values(items)[0] ?? ''));
    }
  };

  // chrome.storage.local.remove signature
  remove = (keys: string | string[], callback?: () => void): void => {
    const list = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, ChangeRecord> = {};
    list.forEach((key) => {
      const oldValue = this.backing.get(key);
      this.backing.delete(key);
      changes[key] = { oldValue, newValue: undefined };
    });
    callback?.();
    this.firehose(changes);
  };

  private firehose(changes: Record<string, ChangeRecord>): void {
    if (Object.keys(changes).length === 0) return;
    this.listeners.forEach((listener) => listener(changes, 'local'));
  }

  onChanged = {
    addListener: (listener: StorageChangeListener): void => {
      this.listeners.add(listener);
    },
    removeListener: (listener: StorageChangeListener): void => {
      this.listeners.delete(listener);
    },
  };

  /** Clear stored values (keeps listeners — module-level subscribers survive). */
  reset(): void {
    this.backing.clear();
    this.afterNextSet = null;
  }

  /** Direct read for assertions (bypasses get() bookkeeping). */
  peek(key: string): string | undefined {
    return this.backing.get(key);
  }

  /** Direct write for assertions/simulation of non-wrapper writers. */
  poke(key: string, value: string): void {
    this.set({ [key]: value });
  }

  /** Number of registered onChanged listeners (leak assertions). */
  listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Install a simulator as `globalThis.chrome` so `chromeStorageApi` and the
 * app store exercise it. Returns the previous chrome global (for restore).
 */
export function installStorageSimulator(sim: StorageSimulator): unknown {
  const previous = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: { get: sim.get, set: sim.set, remove: sim.remove },
      onChanged: sim.onChanged,
    },
  };
  return previous;
}

export function uninstallStorageSimulator(previous?: unknown): void {
  if (previous === undefined) {
    delete (globalThis as { chrome?: unknown }).chrome;
  } else {
    (globalThis as { chrome?: unknown }).chrome = previous;
  }
}

export const APP_KEY = 'tab-manager-storage';

/** Build a persisted blob exactly like createJSONStorage + this wrapper do. */
export function makeEnvelope(
  state: Record<string, unknown>,
  generation?: number,
  version = 1
): string {
  const envelope: Record<string, unknown> = { state, version };
  if (generation !== undefined) envelope.stateGeneration = generation;
  return JSON.stringify(envelope);
}

/** Parse a stored blob for assertions. */
export function readEnvelope(raw: string | undefined): {
  state?: Record<string, unknown>;
  version?: number;
  stateGeneration?: number;
} {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Generalized helpers for the permanent regression suite (task 5.1, spec
// capability `regression-test-suite`). These are the shared vocabulary every
// multi-context scenario is written with: a context factory, blob
// inspectors, and the convergence assertion.
// ---------------------------------------------------------------------------

/** One simulated browser context (fresh generation tracker over chrome). */
export interface SimulatedBrowserContext {
  storage: StateStorage;
  tracker: GenerationTracker;
  /** Raw app blob this context loaded at boot (null when empty/corrupt). */
  loaded: string | null;
}

/**
 * Boot a fresh browser context over the INSTALLED simulator (call
 * `installStorageSimulator` first): creates an independent generation
 * tracker via `createContextStorage()` and performs the boot-time
 * `getItem` load every real context performs at startup. `loaded` is the raw
 * blob the context booted from — null for an empty or quarantined key.
 */
export async function bootContext(
  key: string = APP_KEY
): Promise<SimulatedBrowserContext> {
  const context = createContextStorage();
  const loaded = await context.storage.getItem(key);
  return { storage: context.storage, tracker: context.tracker, loaded };
}

/** Generation inspector: the blob's `stateGeneration` (undefined if absent). */
export function storedGeneration(
  sim: StorageSimulator,
  key: string = APP_KEY
): number | undefined {
  return readEnvelope(sim.peek(key)).stateGeneration;
}

/** The blob's persisted (partialized) state; undefined when nothing stored. */
export function storedState(
  sim: StorageSimulator,
  key: string = APP_KEY
): Record<string, unknown> | undefined {
  return readEnvelope(sim.peek(key)).state;
}

/** The §2 quarantine payload (corrupt blob set aside); undefined if none. */
export function storedQuarantine(
  sim: StorageSimulator
): { quarantinedAt: string; reason: string; raw: string } | undefined {
  const raw = sim.peek(SNAPSHOT_QUARANTINE_KEY);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as {
      quarantinedAt: string;
      reason: string;
      raw: string;
    };
  } catch {
    return undefined;
  }
}

/**
 * Convergence assertion for interleaved writes: the final stored snapshot
 * must contain EXACTLY the committed entities of every participating
 * context — nothing lost, nothing silently clobbered. `expected` maps each
 * persisted entity-list key (e.g. 'notes', 'projects') to the FULL expected
 * set for that list; each entry matches a stored entry with the same `id`
 * whose fields include every field given here (subset match). List ORDER is
 * deliberately not asserted: the merge appends foreign-only entities in
 * arrival order, which is not part of the contract.
 */
export function expectConverged(
  sim: StorageSimulator,
  expected: Record<string, Array<Record<string, unknown>>>
): void {
  const state = storedState(sim);
  Object.entries(expected).forEach(([listKey, expectedEntities]) => {
    const storedList = Array.isArray(state?.[listKey])
      ? (state?.[listKey] as Array<Record<string, unknown>>)
      : [];
    const storedById = new Map(
      storedList.map((item): [string, Record<string, unknown>] => [
        String(item.id),
        item,
      ])
    );
    expect(storedList.map((item) => String(item.id)).sort()).toEqual(
      expectedEntities.map((entity) => String(entity.id)).sort()
    );
    expectedEntities.forEach((entity) => {
      expect(storedById.get(String(entity.id))).toMatchObject(entity);
    });
  });
}
