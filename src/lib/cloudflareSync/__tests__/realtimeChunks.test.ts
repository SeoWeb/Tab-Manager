import {
  handleRealtimeMessage,
  resetRealtimeChunkBuffer,
  type RealtimeStoreLike,
} from '../realtimeMessages';
import type { CloudSyncChange } from '../types';

/**
 * Tests for chunked realtime fan-out reassembly (scale-sync-backend, task 5.4).
 *
 * Wire contract: a notification over the server's size cap arrives as ordered
 * `{ type: 'changes-chunk', seq, total, payload }` frames whose `payload`s are
 * string fragments of ONE serialized `{ type: 'changes', changes: [...] }`
 * message; frames of a group share `total`. Reassembly = concatenate payloads
 * in seq order, JSON.parse, dispatch like a normal `changes` frame.
 */

function makeStore(cursors: Record<string, number> = {}): RealtimeStoreLike & {
  merged: CloudSyncChange[][];
  presence: unknown[][];
  cursors: Record<string, number>;
} {
  const mock = {
    merged: [] as CloudSyncChange[][],
    presence: [] as unknown[][],
    cursors,
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

function serializeChanges(changes: CloudSyncChange[]): string {
  return JSON.stringify({ type: 'changes', changes });
}

/** Split a string into exactly `count` ordered fragments. */
function splitInto(serialized: string, count: number): string[] {
  const size = Math.ceil(serialized.length / count);
  const fragments: string[] = [];
  for (let i = 0; i < serialized.length; i += size) {
    fragments.push(serialized.slice(i, i + size));
  }
  return fragments;
}

/** Build ordered chunk-frame JSON strings for a serialized notification. */
function chunkFrames(serialized: string, fragmentSize: number): string[] {
  const payloads: string[] = [];
  for (let i = 0; i < serialized.length; i += fragmentSize) {
    payloads.push(serialized.slice(i, i + fragmentSize));
  }
  return payloads.map((payload, idx) =>
    JSON.stringify({
      type: 'changes-chunk',
      seq: idx + 1,
      total: payloads.length,
      payload,
    })
  );
}

function chunkFrame(seq: number, total: number, payload: unknown): string {
  return JSON.stringify({ type: 'changes-chunk', seq, total, payload });
}

const noopDeps = (store: RealtimeStoreLike) => ({ clientId: 'ext-me', store });

beforeEach(() => {
  resetRealtimeChunkBuffer();
});

describe('changes-chunk reassembly', () => {
  it('reassembles ordered frames and dispatches exactly once as changes', () => {
    const store = makeStore();
    const changes = [
      baseChange({ id: 7 }),
      baseChange({ id: 9, entity_id: 'col-2' }),
    ];
    const frames = chunkFrames(serializeChanges(changes), 12);
    expect(frames.length).toBeGreaterThan(2);

    // Nothing dispatches until the final frame lands.
    for (let i = 0; i < frames.length - 1; i++) {
      expect(handleRealtimeMessage(frames[i], noopDeps(store))).toBe(true);
      expect(store.mergeRemoteChanges).not.toHaveBeenCalled();
    }
    expect(
      handleRealtimeMessage(frames[frames.length - 1], noopDeps(store))
    ).toBe(true);

    expect(store.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    expect(store.mergeRemoteChanges).toHaveBeenCalledWith(changes, 'ext-me');
    // Same cursor-advance path as a plain changes frame.
    expect(store.setProjectCursor).toHaveBeenCalledWith('p1', 9);
  });

  it('drops the incomplete buffer when a non-chunk frame arrives mid-group', () => {
    const store = makeStore();
    const frames = chunkFrames(serializeChanges([baseChange({ id: 5 })]), 10);

    handleRealtimeMessage(frames[0], noopDeps(store));
    // Unrelated frame interrupts the group...
    expect(
      handleRealtimeMessage(
        JSON.stringify({ type: 'presence', users: [] }),
        noopDeps(store)
      )
    ).toBe(true);
    // ...so the orphaned remainder never dispatches.
    for (const frame of frames.slice(1)) {
      handleRealtimeMessage(frame, noopDeps(store));
    }
    expect(store.mergeRemoteChanges).not.toHaveBeenCalled();
    expect(store.setOnlinePresence).toHaveBeenCalledTimes(1);

    // The dropped group leaves no residue: a fresh complete group works.
    const fresh = chunkFrames(serializeChanges([baseChange({ id: 6 })]), 40);
    for (const frame of fresh) {
      handleRealtimeMessage(frame, noopDeps(store));
    }
    expect(store.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    expect(store.mergeRemoteChanges).toHaveBeenCalledWith(
      [baseChange({ id: 6 })],
      'ext-me'
    );
  });

  it('ignores malformed frames without poisoning later groups', () => {
    const store = makeStore();
    const malformed = [
      chunkFrame(0, 2, 'a'), // seq must be positive
      chunkFrame(1, 0, 'a'), // total must be positive
      chunkFrame(1.5, 2, 'a'), // seq must be an integer
      chunkFrame(3, 2, 'a'), // seq overshoots total
      chunkFrame(1, 1001, 'a'), // total above the guard cap
      chunkFrame(1, 2, 42), // payload must be a string
    ];
    for (const frame of malformed) {
      expect(handleRealtimeMessage(frame, noopDeps(store))).toBe(false);
    }
    expect(store.mergeRemoteChanges).not.toHaveBeenCalled();

    for (const frame of chunkFrames(
      serializeChanges([baseChange({ id: 3 })]),
      8
    )) {
      handleRealtimeMessage(frame, noopDeps(store));
    }
    expect(store.mergeRemoteChanges).toHaveBeenCalledTimes(1);
  });

  it('handles a duplicate seq by overwriting the earlier fragment', () => {
    const store = makeStore();
    const serialized = serializeChanges([baseChange({ id: 4 })]);
    const fragments = splitInto(serialized, 2);
    expect(fragments).toHaveLength(2);

    // A garbage first fragment arrives, then the real one overwrites it.
    expect(
      handleRealtimeMessage(
        chunkFrame(1, 2, '{"type":"changes","cha'),
        noopDeps(store)
      )
    ).toBe(true);
    expect(
      handleRealtimeMessage(chunkFrame(1, 2, fragments[0]), noopDeps(store))
    ).toBe(true);
    expect(
      handleRealtimeMessage(chunkFrame(2, 2, fragments[1]), noopDeps(store))
    ).toBe(true);

    expect(store.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    expect(store.mergeRemoteChanges).toHaveBeenCalledWith(
      [baseChange({ id: 4 })],
      'ext-me'
    );
  });

  it('keeps chunk groups and plain changes frames interleaved correctly', () => {
    const store = makeStore();

    for (const frame of chunkFrames(
      serializeChanges([baseChange({ id: 1 })]),
      10
    )) {
      handleRealtimeMessage(frame, noopDeps(store));
    }
    // Plain unchunked frame between groups — today's exact shape, untouched.
    expect(
      handleRealtimeMessage(
        JSON.stringify({ type: 'changes', changes: [baseChange({ id: 2 })] }),
        noopDeps(store)
      )
    ).toBe(true);
    for (const frame of chunkFrames(
      serializeChanges([baseChange({ id: 3, entity_id: 'col-3' })]),
      6
    )) {
      handleRealtimeMessage(frame, noopDeps(store));
    }

    expect(store.mergeRemoteChanges).toHaveBeenCalledTimes(3);
    expect(store.merged.map((batch) => batch[0].id)).toEqual([1, 2, 3]);
    expect(store.setProjectCursor).toHaveBeenLastCalledWith('p1', 3);
  });

  it('does not dispatch a group whose assembly is not valid changes JSON', () => {
    const store = makeStore();
    // Fragments concatenate to valid JSON, but not a changes message.
    const piece = JSON.stringify({ hello: true });
    handleRealtimeMessage(chunkFrame(1, 2, piece.slice(0, 8)), noopDeps(store));
    handleRealtimeMessage(chunkFrame(2, 2, piece.slice(8)), noopDeps(store));
    expect(store.mergeRemoteChanges).not.toHaveBeenCalled();

    // Fragments that concatenate to invalid JSON are dropped silently too.
    handleRealtimeMessage(chunkFrame(1, 1, '{broken'), noopDeps(store));
    expect(store.mergeRemoteChanges).not.toHaveBeenCalled();
  });
});

// --- End-to-end: the socket wiring in realtime.ts feeds chunk frames through
// the same handler and they reach the store's mergeRemoteChanges. ---

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

describe('realtime socket chunk delivery (end-to-end)', () => {
  let connectProjectRealtime: typeof import('../realtime').connectProjectRealtime;
  let disconnectProjectRealtime: typeof import('../realtime').disconnectProjectRealtime;
  const realFetch = global.fetch;

  beforeAll(async () => {
    const mod = await import('../realtime');
    connectProjectRealtime = mod.connectProjectRealtime;
    disconnectProjectRealtime = mod.disconnectProjectRealtime;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    MockWebSocket.instances = [];
    // The ticket-based handshake (harden-auth-tokens): every connect starts
    // with POST /realtime/ticket, then the socket opens with subprotocols.
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith('/realtime/ticket')) {
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ ticket: 'ticket-e2e', expiresAt: 4102444800 })
            ),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
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
  });

  afterEach(() => {
    disconnectProjectRealtime();
    resetRealtimeChunkBuffer();
    global.fetch = realFetch;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('delivers a chunked fan-out through the socket to mergeRemoteChanges', async () => {
    await connectProjectRealtime('p1');
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeDefined();
    ws.onopen?.();

    // Ticket handshake sanity (harden-auth-tokens): clean URL, ticket only in
    // the subprotocol field.
    expect(ws.url).toBe(
      'ws://localhost:8787/projects/p1/realtime?clientId=ext-test'
    );
    expect(ws.url).not.toContain('token');
    expect(ws.protocols).toEqual(['tabspace-auth', 'ticket-e2e']);

    const changes = [
      baseChange({ id: 11 }),
      baseChange({ id: 12, entity_id: 'col-9' }),
    ];
    const frames = chunkFrames(serializeChanges(changes), 16);
    for (const frame of frames) {
      ws.onmessage?.({ data: frame });
    }

    expect(mockStore.mergeRemoteChanges).toHaveBeenCalledTimes(1);
    expect(mockStore.mergeRemoteChanges).toHaveBeenCalledWith(
      changes,
      'ext-test'
    );
    expect(mockStore.setProjectCursor).toHaveBeenCalledWith('p1', 12);
    expect(mockStore.setRealtimeConnected).toHaveBeenCalledWith(true);
  });

  it('resets the chunk buffer when the socket is torn down', async () => {
    await connectProjectRealtime('p1');
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.onopen?.();

    // First frame of a two-frame group, then the socket is torn down.
    ws.onmessage?.({
      data: chunkFrame(
        1,
        2,
        serializeChanges([baseChange({ id: 20 })]).slice(0, 20)
      ),
    });
    disconnectProjectRealtime();

    // A tail frame still in flight after teardown must not complete a phantom
    // group against the closed socket's stale buffer.
    ws.onmessage?.({
      data: chunkFrame(
        2,
        2,
        serializeChanges([baseChange({ id: 20 })]).slice(20)
      ),
    });

    expect(mockStore.mergeRemoteChanges).not.toHaveBeenCalled();
  });
});
