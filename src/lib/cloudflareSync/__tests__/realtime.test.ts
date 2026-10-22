import {
  handleRealtimeMessage,
  realtimeUrl,
  type RealtimeStoreLike,
} from '../realtimeMessages';
import type { CloudSyncChange } from '../types';
import { onAuthExpired, resetTokenRenewalStateForTests } from '../tokenRenewal';

function makeStore(cursors: Record<string, number> = {}): RealtimeStoreLike & {
  merged: CloudSyncChange[][];
  presence: unknown[][];
  cursors: Record<string, number>;
} {
  const mock = {
    merged: [] as CloudSyncChange[][],
    presence: [] as unknown[][],
    cursors,
    // `handleRealtimeMessage` reads existing cursors from `cloudSync.cursors`.
    cloudSync: { cursors },
    mergeRemoteChanges: jest.fn((changes: CloudSyncChange[]) => {
      mock.merged.push(changes);
    }),
    setProjectCursor: jest.fn((projectId: string, cursor: number) => {
      mock.cursors[projectId] = cursor;
    }),
    setOnlinePresence: jest.fn((users: unknown[]) => {
      mock.presence.push(users);
    }),
  };
  return mock;
}

const baseChange = (
  overrides: Partial<CloudSyncChange> = {}
): CloudSyncChange => ({
  id: 1,
  change_id: 'c1',
  project_id: 'p1',
  actor_id: 'u-other',
  entity_type: 'collection',
  entity_id: 'col-1',
  operation: 'create',
  patch: { name: 'New collection', order: 0 },
  base_version: null,
  client_mutation_id: null,
  client_id: 'ext-other',
  created_at: '2026-06-16T12:00:00.000Z',
  ...overrides,
});

describe('handleRealtimeMessage', () => {
  it('applies a changes frame and advances the cursor to the max id', () => {
    const store = makeStore();
    const changes = [
      baseChange({ id: 7, project_id: 'p1' }),
      baseChange({ id: 9, project_id: 'p1', entity_id: 'col-2' }),
    ];

    const handled = handleRealtimeMessage(
      JSON.stringify({ type: 'changes', changes }),
      { clientId: 'ext-me', store }
    );

    expect(handled).toBe(true);
    expect(store.mergeRemoteChanges).toHaveBeenCalledWith(changes, 'ext-me');
    expect(store.setProjectCursor).toHaveBeenCalledWith('p1', 9);
  });

  it('does not advance the cursor backward', () => {
    const store = makeStore({ p1: 50 });
    handleRealtimeMessage(
      JSON.stringify({ type: 'changes', changes: [baseChange({ id: 10 })] }),
      { clientId: 'ext-me', store }
    );
    // Applied, but cursor stays at the higher existing value.
    expect(store.mergeRemoteChanges).toHaveBeenCalled();
    expect(store.setProjectCursor).not.toHaveBeenCalled();
  });

  it('applies a presence frame', () => {
    const store = makeStore();
    const users = [{ userId: 'u1', displayName: 'Alice', role: 'owner' }];
    const handled = handleRealtimeMessage(
      JSON.stringify({ type: 'presence', users }),
      { clientId: 'ext-me', store }
    );
    expect(handled).toBe(true);
    expect(store.setOnlinePresence).toHaveBeenCalledWith(users);
  });

  it('ignores hello/pong and unknown message types', () => {
    const store = makeStore();
    expect(
      handleRealtimeMessage(JSON.stringify({ type: 'hello' }), {
        clientId: 'x',
        store,
      })
    ).toBe(false);
    expect(
      handleRealtimeMessage(JSON.stringify({ type: 'pong' }), {
        clientId: 'x',
        store,
      })
    ).toBe(false);
    expect(
      handleRealtimeMessage(JSON.stringify({ type: 'mystery' }), {
        clientId: 'x',
        store,
      })
    ).toBe(false);
    expect(store.mergeRemoteChanges).not.toHaveBeenCalled();
    expect(store.setOnlinePresence).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', () => {
    const store = makeStore();
    expect(handleRealtimeMessage('not-json', { clientId: 'x', store })).toBe(
      false
    );
  });

  it('accepts an already-parsed object', () => {
    const store = makeStore();
    const handled = handleRealtimeMessage(
      { type: 'changes', changes: [baseChange({ id: 3 })] },
      { clientId: 'ext-me', store }
    );
    expect(handled).toBe(true);
    expect(store.setProjectCursor).toHaveBeenCalledWith('p1', 3);
  });
});

describe('realtimeUrl', () => {
  it('maps http(s) base to ws(s) and carries ONLY the clientId — never a token', () => {
    expect(realtimeUrl('https://api.example.com/', 'p1', 'ext-1')).toBe(
      'wss://api.example.com/projects/p1/realtime?clientId=ext-1'
    );
    expect(realtimeUrl('http://localhost:8787', 'p 1', 'ext-1')).toBe(
      'ws://localhost:8787/projects/p%201/realtime?clientId=ext-1'
    );
    expect(realtimeUrl('https://api.example.com', 'p1', 'ext-1')).not.toContain(
      'token='
    );
  });
});

// --- Socket lifecycle: ticket exchange + subprotocol handshake (task 4.1) ---

jest.mock('@/stores/appStore', () => ({
  useAppStore: { getState: () => mockStore },
}));

const mockStore = {
  cloudSync: { cursors: {} as Record<string, number> },
  mergeRemoteChanges: jest.fn(),
  setProjectCursor: jest.fn(),
  setOnlinePresence: jest.fn(),
  setRealtimeConnected: jest.fn(),
};

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  url: string;
  protocols: string[];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols)
      ? protocols
      : protocols
        ? [protocols]
        : [];
    MockWebSocket.instances.push(this);
  }
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function jsonError(status: number, message: string): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify({ error: { message } })),
  } as Response;
}

/** In-memory chrome.storage.local with the signed-in fixture values. */
function installChromeStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) {
            if (k === 'cloud-sync-api-base-url')
              out[k] = 'http://localhost:8787';
            if (k === 'cloud-sync-token') out[k] = 'tok';
            if (k === 'cloud-sync-client-id') out[k] = 'ext-test';
          }
          cb(out);
        },
        set: (_obj: Record<string, unknown>, cb: () => void) => cb(),
        remove: (_keys: string | string[], cb: () => void) => cb(),
      },
    },
  };
}

describe('realtime socket connect (ticket-based auth)', () => {
  let connectProjectRealtime: typeof import('../realtime').connectProjectRealtime;
  let disconnectProjectRealtime: typeof import('../realtime').disconnectProjectRealtime;
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeAll(async () => {
    const mod = await import('../realtime');
    connectProjectRealtime = mod.connectProjectRealtime;
    disconnectProjectRealtime = mod.disconnectProjectRealtime;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetTokenRenewalStateForTests();
    installChromeStorage();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    MockWebSocket.instances = [];
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    disconnectProjectRealtime();
    jest.useRealTimers();
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('fetches a ticket, then connects with a clean URL and the auth subprotocols', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonOk({ ticket: 'ticket-1', expiresAt: 4102444800 });
    });

    await connectProjectRealtime('p1');

    // Ticket endpoint hit exactly once, before any WebSocket exists.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8787/realtime/ticket');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'Bearer tok',
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      projectId: 'p1',
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    // Same URL as before MINUS the token query param (clientId is kept)...
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe(
      'ws://localhost:8787/projects/p1/realtime?clientId=ext-test'
    );
    expect(ws.url).not.toContain('token');
    // ...and the ticket travels in the subprotocol field instead.
    expect(ws.protocols).toEqual(['tabspace-auth', 'ticket-1']);
  });

  it('ticket 401 (renewal fails) raises the re-auth signal and never opens a socket', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/realtime/ticket')) {
        return jsonError(401, 'Token expired');
      }
      if (String(url).endsWith('/auth/renew')) {
        return jsonError(401, 'Token expired');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    await connectProjectRealtime('p1');

    // The renew-then-retry path ran (ticket + renew), the single re-auth
    // signal fired, and no socket was opened or reconnect scheduled.
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(mockStore.setRealtimeConnected).not.toHaveBeenCalledWith(true);

    jest.useFakeTimers();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); // ticket + renew only
  });

  it('fetches a FRESH ticket for each reconnect attempt (60 s single-use TTL)', async () => {
    jest.useFakeTimers();
    let issued = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/realtime/ticket')) {
        issued += 1;
        return jsonOk({ ticket: `ticket-${issued}`, expiresAt: 4102444800 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await connectProjectRealtime('p1');
    expect(MockWebSocket.instances[0].protocols).toEqual([
      'tabspace-auth',
      'ticket-1',
    ]);

    // Drop the first socket: backoff schedules attempt 2 at 1000 * 2^1 = 2 s.
    MockWebSocket.instances[0].onclose?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(2);
    // The second handshake presented a NEW ticket — nothing cached.
    expect(MockWebSocket.instances[1].protocols).toEqual([
      'tabspace-auth',
      'ticket-2',
    ]);
  });

  it('ticket network failure follows the reconnect backoff instead of hammering', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network down');
    });

    await connectProjectRealtime('p1');
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // No immediate retry; the first backoff attempt lands at 2 s.
    await jest.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
