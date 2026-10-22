import { StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { validatePersistedSnapshot } from './snapshotValidation';
import { mergeSnapshots } from './mergeSnapshots';

// ---------------------------------------------------------------------------
// Context seams (one module, two backends)
// ---------------------------------------------------------------------------
// This adapter is the single canonical copy for both consumers:
//
//  - Extension contexts (popup / newtab / service worker) have
//    `chrome.storage.local` — the exact backend this wrapper was originally
//    written against (generation tracking, merge-on-write, quarantine).
//  - The plain web build (frontend/) has no `chrome` global; it previously
//    shipped its own IndexedDB-backed adapter (idb-keyval) under the same
//    export contract. That behavior is preserved here as a fallback backend,
//    and the web build additionally GAINS the generation/merge/quarantine
//    logic (web blobs written before this module existed carry no
//    `stateGeneration` and are treated as generation 0 — purely additive).
//  - SSR / static pre-render has neither backend: warn and no-op, so the
//    store simply reports "nothing persisted" during SSG.
//
// Every storage read/write below is routed through `rawGet`/`rawSet`/
// `rawRemove`, which pick the backend at call time. No other branching exists.

// Quarantine key: snapshots that fail structural validation are copied here
// (latest wins) before the original key is removed, so a corrupt blob is
// never silently wiped — it stays recoverable and diagnosable.
export const SNAPSHOT_QUARANTINE_KEY = 'tab-manager-storage.quarantine';

/**
 * The app-state blob key (the persist middleware `name`). Generation tracking,
 * merge-on-write, and structural validation apply ONLY to this key; every
 * other key (e.g. `sidebar-state`, which stores a bare JSON boolean) passes
 * through untouched.
 */
export const APP_STATE_STORAGE_KEY = 'tab-manager-storage';

// ---------------------------------------------------------------------------
// Persisted blob schema
// ---------------------------------------------------------------------------
// The persist middleware serializes `{ state, version }`; this wrapper adds a
// monotonic `stateGeneration` to the envelope:
//
//   { state: <partialized AppState>, version: number, stateGeneration: number }
//
// Neither backend has transactions or compare-and-swap, so the generation
// counter is what lets each context detect that someone else wrote since it
// last looked and merge instead of clobbering. Legacy blobs written before
// this field existed are treated as generation 0. The field is purely
// additive: old readers ignore it, and `validatePersistedSnapshot` allows
// unknown envelope keys.

interface PersistedEnvelope {
  state?: unknown;
  version?: unknown;
  stateGeneration?: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parse a raw stored blob into its envelope; null when absent or not JSON. */
export function parsePersistedEnvelope(
  raw: string | null | undefined
): PersistedEnvelope | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Generation carried by an envelope. Absent (legacy blob) or invalid values
 * resolve to 0 so the first write lands at 1 and stays monotonic.
 */
export function readEnvelopeGeneration(
  envelope: PersistedEnvelope | null
): number {
  const gen = envelope?.stateGeneration;
  return typeof gen === 'number' && Number.isFinite(gen) ? gen : 0;
}

// ---------------------------------------------------------------------------
// Raw string-KV backends
// ---------------------------------------------------------------------------

const isChromeStorageAvailable = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

/**
 * True in a plain-browser context where IndexedDB is usable. During SSR /
 * static pre-render neither backend exists and every raw helper degrades to a
 * logged no-op, exactly as the extension adapter did when `chrome` was absent.
 */
const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

// idb-keyval stores structured values; the persist middleware hands us JSON
// strings, which are stored and returned verbatim (no extra (de)serialization
// — `createJSONStorage` already did it). Failures are logged and degrade to
// "nothing persisted" instead of throwing into the store.
const idbGet = async (name: string): Promise<string | null> => {
  try {
    const value = await get<string>(name);
    return value ?? null;
  } catch (error) {
    console.error(`IndexedDB getItem failed for "${name}":`, error);
    return null;
  }
};

const idbSet = async (name: string, value: string): Promise<void> => {
  try {
    await set(name, value);
  } catch (error) {
    console.error(`IndexedDB setItem failed for "${name}":`, error);
  }
};

const idbRemove = async (name: string): Promise<void> => {
  try {
    await del(name);
  } catch (error) {
    console.error(`IndexedDB removeItem failed for "${name}":`, error);
  }
};

/** Read a raw string: chrome.storage.local when present, else IndexedDB. */
const rawGet = (name: string): Promise<string | null> => {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([name], (result) => {
        resolve((result?.[name] as string) ?? null);
      });
    });
  }
  if (!isBrowser()) {
    console.warn(
      'No persistent storage available in this context. Persisted state will not be loaded.'
    );
    return Promise.resolve(null);
  }
  return idbGet(name);
};

/** Write a raw string: chrome.storage.local when present, else IndexedDB. */
const rawSet = (name: string, value: string): Promise<void> => {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [name]: value }, () => resolve());
    });
  }
  if (!isBrowser()) {
    console.warn(
      'No persistent storage available in this context. State will not be persisted.'
    );
    return Promise.resolve();
  }
  return idbSet(name, value);
};

/** Remove a key: chrome.storage.local when present, else IndexedDB. */
const rawRemove = (name: string): Promise<void> => {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([name], () => resolve());
    });
  }
  if (!isBrowser()) {
    console.warn(
      'No persistent storage available in this context. Item will not be removed from persisted state.'
    );
    return Promise.resolve();
  }
  return idbRemove(name);
};

// ---------------------------------------------------------------------------
// Per-context generation tracking (task 1.1)
// ---------------------------------------------------------------------------

/**
 * Each browser context (popup / newtab / service worker / web tab) runs its
 * own JS runtime, so the tracker is module state per context by construction.
 * `observed` is the generation this context last read from storage (via
 * getItem, an onChanged event, or its own write); `written` is the generation
 * this context last successfully wrote (drives onChanged self-echo checks).
 */
export interface GenerationTracker {
  observed: number | null;
  written: number | null;
}

const createGenerationTracker = (): GenerationTracker => ({
  observed: null,
  written: null,
});

interface ContextualStorage {
  storage: StateStorage;
  tracker: GenerationTracker;
}

/**
 * Create an independent storage context (its own generation tracker) over the
 * shared backend. Production code uses the module-level `chromeStorageApi`
 * singleton — one context per JS runtime. The factory exists so tests can
 * simulate multiple browser contexts against one backing store (see the
 * storage simulator suites).
 */
export function createContextStorage(): ContextualStorage {
  const tracker = createGenerationTracker();

  const storage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
      // Non-app keys (e.g. the sidebar boolean) are a plain passthrough —
      // validation and generation tracking are app-blob concerns only.
      if (name !== APP_STATE_STORAGE_KEY) {
        return rawGet(name);
      }

      const raw = await rawGet(name);
      if (raw === null) {
        tracker.observed = null;
        return null;
      }

      const validation = validatePersistedSnapshot(raw);
      if (validation.ok) {
        // Observe the stored generation so the next write can detect skew.
        tracker.observed = readEnvelopeGeneration(parsePersistedEnvelope(raw));
        return raw;
      }

      // Structurally invalid snapshot: quarantine it (copy aside, latest
      // wins), drop the original key, and report. The app then boots with
      // default state while the corrupt blob stays recoverable under the
      // quarantine key — no silent wipe of user data.
      console.error(
        `Persisted snapshot for "${name}" failed validation: ${validation.reason}. Quarantining; booting with defaults.`
      );
      try {
        await rawSet(
          SNAPSHOT_QUARANTINE_KEY,
          JSON.stringify({
            quarantinedAt: new Date().toISOString(),
            reason: validation.reason,
            raw,
          })
        );
        await rawRemove(name);
        tracker.observed = null;
        return null;
      } catch (error) {
        // Never let quarantine bookkeeping break the load path.
        console.error(
          'Failed to quarantine invalid persisted snapshot:',
          error
        );
        tracker.observed = null;
        return null;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      if (name !== APP_STATE_STORAGE_KEY) {
        await rawSet(name, value);
        return;
      }

      const storedRaw = await rawGet(name);
      const storedEnvelope = parsePersistedEnvelope(storedRaw);
      const storedGeneration = readEnvelopeGeneration(storedEnvelope);
      const storedState = storedEnvelope?.state;

      let pendingEnvelope: PersistedEnvelope | null = null;
      try {
        const parsed: unknown = JSON.parse(value);
        if (isPlainObject(parsed)) pendingEnvelope = parsed;
      } catch {
        pendingEnvelope = null;
      }
      const pendingState = isPlainObject(pendingEnvelope?.state)
        ? (pendingEnvelope as { state: Record<string, unknown> }).state
        : null;
      const version =
        typeof pendingEnvelope?.version === 'number'
          ? pendingEnvelope.version
          : 1;

      // Defensive: not a mergeable app-state envelope (never expected from
      // createJSONStorage). Write as-is rather than corrupting it further.
      if (!pendingState) {
        await rawSet(name, value);
        return;
      }

      // Write-skew detection: the stored generation moved since this context
      // last observed it, so another context persisted. Merge the pending
      // snapshot into the freshly stored blob BEFORE writing (the store's
      // set() path stays synchronous — the merge happens here, in the async
      // storage wrapper, which is the single choke point every context uses).
      const skew =
        tracker.observed !== null &&
        storedEnvelope !== null &&
        storedGeneration !== tracker.observed;

      const stateToWrite = skew
        ? mergeSnapshots(storedState, pendingState)
        : pendingState;

      // Canonical comparison (key-order-insensitive) of what we are about to
      // write against what is stored. Equal content means this write is a
      // no-op — most commonly zustand's rehydrate write-back (persist calls
      // setItem after every rehydrate even when nothing changed). Skipping it
      // prevents the onChanged → rehydrate → write-back ping-pong between
      // contexts: no generation bump, no onChanged event, loop terminates.
      const serialize = (state: unknown, generation: number): string =>
        JSON.stringify({ state, version, stateGeneration: generation });

      if (canonicalEquals(stateToWrite, storedState)) {
        tracker.observed = storedGeneration;
        return;
      }

      const writeGeneration = storedGeneration + 1;
      await rawSet(name, serialize(stateToWrite, writeGeneration));
      tracker.written = writeGeneration;
      tracker.observed = writeGeneration;

      if (!skew) return;

      // We detected skew and merged before writing. Because storage has no
      // compare-and-swap, another context may still have written between our
      // read and write (clobbering us) or immediately after (being clobbered
      // by us). Verify once: re-read and, if the blob is no longer exactly
      // what we wrote, retry ONCE — merge the fresh blob with the same
      // pending snapshot and write again. Bounded at one retry by design; the
      // merge keeps entity data correct either way, so a second loss only
      // risks generation monotonicity in a microscopic race window.
      const recheckRaw = await rawGet(name);
      const recheckEnvelope = parsePersistedEnvelope(recheckRaw);
      const recheckGeneration = readEnvelopeGeneration(recheckEnvelope);
      const weWon =
        recheckGeneration === writeGeneration &&
        canonicalEquals(recheckEnvelope?.state ?? null, stateToWrite);
      if (weWon) return;

      tracker.observed = recheckGeneration;
      const freshState = isPlainObject(recheckEnvelope?.state)
        ? recheckEnvelope?.state
        : null;
      const mergedAgain = mergeSnapshots(freshState, pendingState);
      if (canonicalEquals(mergedAgain, freshState)) {
        // The fresh blob already contains everything we had; adopt it instead
        // of writing an identical blob.
        return;
      }
      const retryGeneration = recheckGeneration + 1;
      await rawSet(name, serialize(mergedAgain, retryGeneration));
      tracker.written = retryGeneration;
      tracker.observed = retryGeneration;
    },

    removeItem: async (name: string): Promise<void> => {
      await rawRemove(name);
      if (name === APP_STATE_STORAGE_KEY) tracker.observed = null;
    },
  };

  return { storage, tracker };
}

// ---------------------------------------------------------------------------
// Module singleton — the app context's storage adapter + tracker
// ---------------------------------------------------------------------------

const appContext = createContextStorage();

// Custom storage adapter (generation-checked writes). The name is historical:
// in extension contexts it wraps chrome.storage.local; in plain-web contexts
// it wraps IndexedDB via idb-keyval. Importers (appStore, persistSafety, the
// sidebar actions) use the same contract in both.
export const chromeStorageApi: StateStorage = appContext.storage;

/** This context's generation tracker (observed/written generations). */
export function getGenerationTracker(): GenerationTracker {
  return appContext.tracker;
}

/** Test hook: reset the singleton's generation bookkeeping between tests. */
export function resetGenerationTrackingForTests(): void {
  appContext.tracker.observed = null;
  appContext.tracker.written = null;
}

// ---------------------------------------------------------------------------
// Canonical equality helper
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON stringify (object keys sorted recursively) so two
 * snapshots compare equal regardless of property insertion order. Arrays keep
 * their order (entity order is meaningful in the UI). Values here are always
 * plain JSON — the wrapper parses raw blobs without a Date reviver.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (Array.isArray(item)) return item;
    if (isPlainObject(item)) {
      const sorted: Record<string, unknown> = {};
      Object.keys(item)
        .sort()
        .forEach((k) => {
          sorted[k] = item[k];
        });
      return sorted;
    }
    return item;
  });
}

function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

// ---------------------------------------------------------------------------
// onChanged subscription (task 1.4)
// ---------------------------------------------------------------------------

export interface StorageChangeSubscriptionOptions {
  /** Called (debounced) when another context persisted the state key. */
  onExternalChange: (generation: number) => void;
  /** Storage key to watch. Defaults to the app-state blob key. */
  storageKey?: string;
  /** Trailing debounce window in ms. Defaults to 500 (per the change design). */
  debounceMs?: number;
}

/**
 * Subscribe to `chrome.storage.onChanged` for the app-state blob and invoke
 * `onExternalChange` after a 500 ms trailing debounce whenever ANOTHER context
 * persisted it. Self-echo suppression: events whose new generation equals this
 * context's last written generation are ignored (the wrapper records its
 * writes in the tracker). External events update the tracker's observed
 * generation, so the next local write compares against fresh state.
 *
 * Chrome-only seam: `chrome.storage.onChanged` is the extension's cross-context
 * push channel. Plain-web tabs have no equivalent (the web build rehydrates on
 * focus/visibility via the app layer instead), so without the API this returns
 * a no-op detach — same as the SSR / unmocked-test case.
 *
 * Without CAS, two contexts can theoretically write the same generation
 * concurrently; such a collision can make one event look like an echo. The
 * setItem merge path still protects the data in that case — only the
 * debounced rehydrate is skipped, and the next real write re-broadcasts.
 */
export function subscribeToStorageChanges(
  options: StorageChangeSubscriptionOptions,
  tracker: GenerationTracker = appContext.tracker
): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage?.onChanged?.addListener
  ) {
    return () => undefined;
  }

  const key = options.storageKey ?? APP_STATE_STORAGE_KEY;
  const debounceMs = options.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    const change = changes[key];
    // Removal events carry no new blob — nothing to rehydrate.
    if (!change || typeof change.newValue !== 'string') return;

    const generation = readEnvelopeGeneration(
      parsePersistedEnvelope(change.newValue)
    );

    // Self-echo: we wrote this generation ourselves.
    if (tracker.written !== null && generation === tracker.written) return;

    tracker.observed = generation;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      options.onExternalChange(generation);
    }, debounceMs);
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    chrome.storage.onChanged.removeListener(listener);
  };
}
