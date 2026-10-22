/**
 * Tab-session auto-save single-writer tests (fix-cross-context-data-loss §4,
 * tasks 4.1 / 4.3).
 *
 * Guarantees tested against one mocked chrome APIs object:
 *
 *  1. Only the service-worker context registers tab listeners and the periodic
 *     save — page contexts (popup, newtab) get a no-op.
 *  2. Page contexts never touch session storage: a save delegates via a
 *     `{type:'save-tab-session'}` message and the restore-eligibility check
 *     delegates via `{type:'restore-tab-session'}`; when the worker is
 *     unreachable (`chrome.runtime.lastError`) they log and give up.
 *  3. Worker context writes session storage directly and never sends messages.
 *  4. Two page contexts + the worker ⇒ exactly one listener set and one write
 *     path.
 *
 * The worker context is simulated exactly the way the product code detects it
 * (`typeof document === 'undefined'`, cf. `cloudflareSync/syncLock.ts`): the
 * jsdom `document` property is removed for the duration of a call and restored
 * via its original property descriptor afterwards.
 */
import {
  SAVE_TAB_SESSION_MESSAGE_TYPE,
  RESTORE_TAB_SESSION_MESSAGE_TYPE,
  isWorkerContext,
  autoSaveCurrentSession,
  checkForSessionRestore,
  startAutoSaveMonitoring,
} from '../autoSave';
import { CURRENT_SESSION_KEY } from '../sessions';

type TabEventName = 'onCreated' | 'onRemoved' | 'onUpdated';

interface Harness {
  store: Record<string, unknown>;
  storageSets: Array<Record<string, unknown>>;
  storageRemoves: string[][];
  tabListeners: Record<TabEventName, Array<() => void>>;
  windows: Array<{
    id: number;
    focused: boolean;
    type: string;
    tabs: Array<{ id: number; url: string; title: string; windowId: number }>;
  }>;
  windowsCreated: number;
  sentMessages: Array<{ type?: string }>;
  /** Queued replies for outgoing messages; `{ok:true}` when exhausted. */
  replies: Array<{ ok: boolean; restored?: boolean } | undefined>;
  lastError: { message: string } | null;
}

const TAB_EVENT_NAMES: TabEventName[] = ['onCreated', 'onRemoved', 'onUpdated'];

function installChrome(): Harness {
  const h: Harness = {
    store: {},
    storageSets: [],
    storageRemoves: [],
    tabListeners: { onCreated: [], onRemoved: [], onUpdated: [] },
    windows: [],
    windowsCreated: 0,
    sentMessages: [],
    replies: [],
    lastError: null,
  };

  const tabEvent = (name: TabEventName) => ({
    addListener: (fn: () => void) => {
      h.tabListeners[name].push(fn);
    },
    removeListener: (fn: () => void) => {
      h.tabListeners[name] = h.tabListeners[name].filter((f) => f !== fn);
    },
  });

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in h.store) out[k] = h.store[k];
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          h.storageSets.push(obj);
          Object.assign(h.store, obj);
          // Product code writes without a completion callback; Chrome allows it.
          cb?.();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          h.storageRemoves.push(keysArr);
          for (const k of keysArr) delete h.store[k];
          cb?.();
        },
      },
    },
    tabs: {
      onCreated: tabEvent('onCreated'),
      onRemoved: tabEvent('onRemoved'),
      onUpdated: tabEvent('onUpdated'),
      query: async () => [],
    },
    windows: {
      getAll: async () => h.windows,
      create: async () => {
        h.windowsCreated += 1;
        return { id: 900 + h.windowsCreated, focused: true, type: 'normal' };
      },
    },
    runtime: {
      sendMessage: (
        message: { type?: string },
        cb: (response?: unknown) => void
      ) => {
        h.sentMessages.push(message);
        cb(h.lastError ? undefined : (h.replies.shift() ?? { ok: true }));
      },
      get lastError() {
        return h.lastError;
      },
    },
  };
  return h;
}

const globalWithDocument = globalThis as { document?: unknown };

/** Run `fn` with `document` removed — exactly the worker-context check. */
async function inWorkerContext<T>(fn: () => T | Promise<T>): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  if (!desc) throw new Error('jsdom did not expose a document descriptor');
  delete globalWithDocument.document;
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'document', desc);
  }
}

function totalTabListeners(h: Harness): number {
  return TAB_EVENT_NAMES.reduce(
    (sum, name) => sum + h.tabListeners[name].length,
    0
  );
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('worker-context detection (autoSave.isWorkerContext)', () => {
  beforeEach(() => {
    installChrome();
  });

  it('is false for a page context (document present) and true without document', async () => {
    expect(isWorkerContext()).toBe(false);
    await inWorkerContext(() => {
      expect(isWorkerContext()).toBe(true);
    });
    expect(isWorkerContext()).toBe(false);
  });
});

describe('page contexts never touch session storage (§4)', () => {
  let h: Harness;

  beforeEach(() => {
    h = installChrome();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('startAutoSaveMonitoring registers nothing and saves nothing', async () => {
    const cleanup = startAutoSaveMonitoring();

    await jest.advanceTimersByTimeAsync(35_000);

    expect(totalTabListeners(h)).toBe(0);
    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toHaveLength(0);
    expect(h.sentMessages).toHaveLength(0);
    expect(typeof cleanup).toBe('function');
    cleanup(); // must be safe to call
  });

  it('autoSaveCurrentSession delegates via save-tab-session and writes nothing', async () => {
    h.windows = [
      {
        id: 1,
        focused: true,
        type: 'normal',
        tabs: [
          { id: 11, url: 'https://example.com', title: 'Ex', windowId: 1 },
        ],
      },
    ];

    await autoSaveCurrentSession();

    expect(h.sentMessages).toEqual([{ type: SAVE_TAB_SESSION_MESSAGE_TYPE }]);
    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toHaveLength(0);
  });

  it('autoSaveCurrentSession logs and gives up when the worker is unreachable', async () => {
    h.lastError = {
      message: 'Could not establish connection. Receiving end does not exist.',
    };
    const warn = jest.spyOn(console, 'warn');

    await expect(autoSaveCurrentSession()).resolves.toBeUndefined();

    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('checkForSessionRestore delegates via restore-tab-session and reads no storage', async () => {
    h.replies = [{ ok: true, restored: false }];

    await expect(checkForSessionRestore()).resolves.toBe(false);

    expect(h.sentMessages).toEqual([
      { type: RESTORE_TAB_SESSION_MESSAGE_TYPE },
    ]);
    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toHaveLength(0);
  });

  it('checkForSessionRestore returns the worker answer verbatim', async () => {
    h.replies = [{ ok: true, restored: true }];

    await expect(checkForSessionRestore()).resolves.toBe(true);
  });

  it('checkForSessionRestore logs and returns false when the worker is unreachable', async () => {
    h.lastError = { message: 'Receiving end does not exist.' };
    const warn = jest.spyOn(console, 'warn');

    await expect(checkForSessionRestore()).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(h.storageSets).toHaveLength(0);
  });
});

describe('worker context owns listeners and the write path (§4)', () => {
  let h: Harness;

  beforeEach(() => {
    h = installChrome();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('startAutoSaveMonitoring registers exactly one listener per tab event', async () => {
    const cleanup = await inWorkerContext(() =>
      Promise.resolve(startAutoSaveMonitoring())
    );

    expect(totalTabListeners(h)).toBe(3);

    await inWorkerContext(async () => cleanup());
    expect(totalTabListeners(h)).toBe(0);
  });

  it('the periodic save writes session storage directly and sends no message', async () => {
    h.windows = [
      {
        id: 1,
        focused: true,
        type: 'normal',
        tabs: [
          { id: 11, url: 'https://example.com', title: 'Ex', windowId: 1 },
        ],
      },
    ];

    await inWorkerContext(() => autoSaveCurrentSession());

    expect(h.sentMessages).toHaveLength(0);
    expect(h.storageSets).toHaveLength(1);
    const written = h.storageSets[0][CURRENT_SESSION_KEY] as {
      timestamp: number;
      windows: unknown[];
    };
    expect(written.windows).toHaveLength(1);
  });

  it('with no open windows the worker clears the key instead of writing', async () => {
    await inWorkerContext(() => autoSaveCurrentSession());

    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toEqual([[CURRENT_SESSION_KEY]]);
  });

  it('initial + tab-event saves are debounced into single writes', async () => {
    const cleanup = await inWorkerContext(() =>
      Promise.resolve(startAutoSaveMonitoring())
    );
    h.windows = [
      {
        id: 1,
        focused: true,
        type: 'normal',
        tabs: [
          { id: 11, url: 'https://example.com', title: 'Ex', windowId: 1 },
        ],
      },
    ];

    // Initial deferred save (1 s) — one write.
    await inWorkerContext(() => jest.advanceTimersByTimeAsync(1_000));
    expect(h.storageSets).toHaveLength(1);

    // Three rapid tab events collapse into ONE debounced write (2 s).
    await inWorkerContext(async () => {
      h.tabListeners.onCreated.forEach((fn) => fn());
      h.tabListeners.onRemoved.forEach((fn) => fn());
      h.tabListeners.onUpdated.forEach((fn) => fn());
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(h.storageSets).toHaveLength(2);

    await inWorkerContext(async () => cleanup());
    // No further writes after cleanup.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(h.storageSets).toHaveLength(2);
  });

  it('concurrent eligibility checks share one run (no duplicate restores)', async () => {
    h.store[CURRENT_SESSION_KEY] = {
      timestamp: Date.now(),
      windows: [{ tabs: [{ url: 'https://a.test' }] }],
    };

    const [first, second] = await inWorkerContext(() =>
      Promise.all([checkForSessionRestore(), checkForSessionRestore()])
    );

    expect(first).toBe(true);
    expect(second).toBe(true);
    // Both requests, one restore: chrome.windows.create ran exactly once.
    expect(h.windowsCreated).toBe(1);
  });

  it('eligibility check skips the restore when normal windows are open', async () => {
    h.windows = [
      {
        id: 1,
        focused: true,
        type: 'normal',
        tabs: [
          { id: 11, url: 'https://example.com', title: 'Ex', windowId: 1 },
        ],
      },
    ];

    await expect(inWorkerContext(() => checkForSessionRestore())).resolves.toBe(
      false
    );

    expect(h.windowsCreated).toBe(0);
    expect(h.storageSets).toHaveLength(0);
    expect(h.storageRemoves).toHaveLength(0);
  });

  it('an expired (>24h) stored session is dropped, not restored', async () => {
    h.store[CURRENT_SESSION_KEY] = {
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
      windows: [{ tabs: [{ url: 'https://a.test' }] }],
    };

    await expect(inWorkerContext(() => checkForSessionRestore())).resolves.toBe(
      false
    );

    expect(h.windowsCreated).toBe(0);
    expect(h.storageRemoves).toEqual([[CURRENT_SESSION_KEY]]);
  });
});

describe('two page contexts + the worker ⇒ one listener set, one write path', () => {
  let h: Harness;

  beforeEach(() => {
    h = installChrome();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('pages delegate, the worker alone registers listeners and writes', async () => {
    h.windows = [
      {
        id: 1,
        focused: true,
        type: 'normal',
        tabs: [
          { id: 11, url: 'https://example.com', title: 'Ex', windowId: 1 },
        ],
      },
    ];

    // The worker boots and owns auto-save.
    const cleanupWorker = await inWorkerContext(() =>
      Promise.resolve(startAutoSaveMonitoring())
    );
    expect(totalTabListeners(h)).toBe(3);

    // Popup + newtab come up and each try their old per-page behaviour.
    const cleanupPage1 = startAutoSaveMonitoring();
    const cleanupPage2 = startAutoSaveMonitoring();
    expect(totalTabListeners(h)).toBe(3); // pages added zero listeners

    await autoSaveCurrentSession(); // page 1 needs a save
    await autoSaveCurrentSession(); // page 2 needs a save
    expect(h.sentMessages).toEqual([
      { type: SAVE_TAB_SESSION_MESSAGE_TYPE },
      { type: SAVE_TAB_SESSION_MESSAGE_TYPE },
    ]);
    expect(h.storageSets).toHaveLength(0); // pages never wrote…
    expect(h.storageRemoves).toHaveLength(0);

    // …the worker's own saves are the only writes (initial 1 s + debounced 2 s).
    await inWorkerContext(() => jest.advanceTimersByTimeAsync(1_000));
    await inWorkerContext(async () => {
      h.tabListeners.onUpdated.forEach((fn) => fn());
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(h.storageSets).toHaveLength(2);

    // Page restore checks also go through the worker, without touching storage.
    await checkForSessionRestore();
    await checkForSessionRestore();
    expect(h.sentMessages.slice(-2).map((m) => m.type)).toEqual([
      RESTORE_TAB_SESSION_MESSAGE_TYPE,
      RESTORE_TAB_SESSION_MESSAGE_TYPE,
    ]);
    expect(h.storageSets).toHaveLength(2);

    cleanupPage1();
    cleanupPage2();
    await inWorkerContext(async () => cleanupWorker());
    expect(totalTabListeners(h)).toBe(0);
    await flushMicrotasks();
  });
});
