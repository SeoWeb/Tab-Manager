/**
 * Background tab-session message wiring (fix-cross-context-data-loss §4,
 * task 4.2).
 *
 * The service worker is the single writer for `current_tab_session`: page
 * contexts send `{type:'save-tab-session'}` / `{type:'restore-tab-session'}`
 * and the worker performs the only write / runs the only eligibility check.
 * These tests exercise the real handler registered by `background/index.ts`
 * (with the cloud-sync/token/quick-clip collaborators mocked out) against one
 * mocked chrome APIs object:
 *
 *  - a save message produces exactly one session-storage write and no
 *    outgoing runtime message,
 *  - a restore message runs the eligibility check and answers with its
 *    result,
 *  - unknown messages are ignored (no response, channel not held),
 *  - a failing write answers `{ok:false}` instead of throwing,
 *  - onStartup runs the session-restore eligibility check.
 *
 * The worker context is simulated the way the product code detects it
 * (`typeof document === 'undefined'`, cf. `cloudflareSync/syncLock.ts`).
 */
type MessageHandler = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void
) => unknown;

jest.mock('@/lib/cloudflareSync/backgroundSync', () => ({
  backgroundSyncAll: jest.fn(async () => ({ projects: 0, status: 'synced' })),
  backgroundReconcileAll: jest.fn(async () => ({
    projects: 0,
    status: 'synced',
  })),
  getLastReconciledAt: jest.fn(async () => null),
}));

jest.mock('@/lib/cloudflareSync/tokenRenewal', () => ({
  TOKEN_RENEWAL_ALARM: 'token-renewal',
  ensureTokenRenewal: jest.fn(async () => undefined),
  runTokenRenewal: jest.fn(async () => undefined),
}));

jest.mock('../quickClip', () => ({
  registerQuickClipMenu: jest.fn(),
  onQuickClipClicked: jest.fn(async () => undefined),
}));

// Partial mock: `autoSaveCurrentSession` is replaceable so the handler's
// rejection path ({ok:false}) can be exercised; everything else stays real.
jest.mock('@/lib/tabSessionService/autoSave', () => ({
  ...jest.requireActual('@/lib/tabSessionService/autoSave'),
  autoSaveCurrentSession: jest.fn(),
}));

import { autoSaveCurrentSession } from '@/lib/tabSessionService/autoSave';
import type * as AutoSaveModule from '@/lib/tabSessionService/autoSave';

const realAutoSave = jest.requireActual(
  '@/lib/tabSessionService/autoSave'
) as typeof AutoSaveModule;

const mockedAutoSaveCurrentSession =
  autoSaveCurrentSession as unknown as jest.Mock;

interface Harness {
  store: Record<string, unknown>;
  storageSets: Array<Record<string, unknown>>;
  windows: Array<{
    id: number;
    focused: boolean;
    type: string;
    tabs: Array<{ id: number; url: string; title: string; windowId: number }>;
  }>;
  windowsCreated: number;
  sentMessages: Array<{ type?: string }>;
  failNextGetAll: boolean;
  onMessageListeners: MessageHandler[];
  onStartupListeners: Array<() => void>;
}

function installChrome(): Harness {
  const h: Harness = {
    store: {},
    storageSets: [],
    windows: [],
    windowsCreated: 0,
    sentMessages: [],
    failNextGetAll: false,
    onMessageListeners: [],
    onStartupListeners: [],
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
          for (const k of keysArr) if (k in h.store) out[k] = h.store[k];
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          h.storageSets.push(obj);
          Object.assign(h.store, obj);
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys])
            delete h.store[k];
          cb();
        },
      },
    },
    tabs: {
      onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
      query: async () => [],
    },
    windows: {
      getAll: async () => {
        if (h.failNextGetAll) {
          h.failNextGetAll = false;
          throw new Error('windows API exploded');
        }
        return h.windows;
      },
      create: async () => {
        h.windowsCreated += 1;
        return { id: 900 + h.windowsCreated, focused: true, type: 'normal' };
      },
    },
    runtime: {
      onInstalled: {
        addListener: jest.fn(),
      },
      onStartup: {
        addListener: (fn: () => void) => {
          h.onStartupListeners.push(fn);
        },
      },
      onMessage: {
        addListener: (fn: MessageHandler) => {
          h.onMessageListeners.push(fn);
        },
      },
      sendMessage: (
        message: { type?: string },
        cb: (response?: unknown) => void
      ) => {
        h.sentMessages.push(message);
        cb({ ok: true });
      },
    },
    alarms: {
      create: jest.fn(),
      onAlarm: {
        addListener: jest.fn(),
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

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

describe('background tab-session message wiring', () => {
  let h: Harness;
  let handler: MessageHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendResponse: any;

  beforeAll(async () => {
    h = installChrome();
    // Import AFTER the chrome mock exists: background/index.ts registers its
    // chrome.runtime/onStartup listeners at module load.
    await import('../index');
    handler = h.onMessageListeners[0];
  });

  beforeEach(() => {
    // Fresh per-test state; the module under test stays cached in the registry.
    h.store = {};
    h.storageSets = [];
    h.sentMessages = [];
    h.windows = [];
    h.windowsCreated = 0;
    h.failNextGetAll = false;
    sendResponse = jest.fn();
    // Default: the mocked export delegates to the real implementation.
    mockedAutoSaveCurrentSession.mockImplementation(
      realAutoSave.autoSaveCurrentSession
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers the onMessage listener at the top level', () => {
    expect(handler).toBeDefined();
  });

  it('answers save-tab-session with the single session-storage write', async () => {
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

    const keepOpen = await inWorkerContext(async () =>
      handler({ type: 'save-tab-session' }, {}, sendResponse)
    );

    expect(keepOpen).toBe(true); // async response: channel held open
    await flush();

    expect(h.storageSets).toHaveLength(1);
    expect(h.storageSets[0]).toHaveProperty('current_tab_session');
    expect(h.sentMessages).toHaveLength(0); // the worker writes, never delegates
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('answers restore-tab-session with the eligibility result', async () => {
    h.store['current_tab_session'] = {
      timestamp: Date.now(),
      windows: [{ tabs: [{ url: 'https://a.test' }] }],
    };

    await inWorkerContext(async () =>
      handler({ type: 'restore-tab-session' }, {}, sendResponse)
    );
    await flush();

    // One eligibility check, one restored window, no session write.
    expect(h.windowsCreated).toBe(1);
    expect(h.storageSets).toHaveLength(0);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, restored: true });
  });

  it('ignores unknown messages without responding', async () => {
    const keepOpenUnknown = handler(
      { type: 'something-unrelated' },
      {},
      sendResponse
    );
    const keepOpenNull = handler(null, {}, sendResponse);

    expect(keepOpenUnknown).toBeUndefined();
    expect(keepOpenNull).toBeUndefined();
    await flush();

    expect(sendResponse).not.toHaveBeenCalled();
    expect(h.storageSets).toHaveLength(0);
  });

  it('answers ok:false when the handling rejects instead of throwing', async () => {
    mockedAutoSaveCurrentSession.mockRejectedValueOnce(
      new Error('storage exploded')
    );

    await inWorkerContext(async () =>
      handler({ type: 'save-tab-session' }, {}, sendResponse)
    );
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(h.storageSets).toHaveLength(0);
  });

  it('runs the session-restore eligibility check on startup', async () => {
    const onStartup = h.onStartupListeners[0];
    expect(onStartup).toBeDefined();

    h.store['current_tab_session'] = {
      timestamp: Date.now(),
      windows: [{ tabs: [{ url: 'https://a.test' }] }],
    };

    await inWorkerContext(async () => onStartup());
    await flush();

    expect(h.windowsCreated).toBe(1);
  });
});
