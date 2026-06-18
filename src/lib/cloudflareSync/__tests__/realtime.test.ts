import {
  handleRealtimeMessage,
  realtimeUrl,
  type RealtimeStoreLike,
} from '../realtimeMessages';
import type { CloudSyncChange } from '../types';

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
  it('maps http(s) base to ws(s) and carries token + clientId as query', () => {
    expect(realtimeUrl('https://api.example.com/', 'p1', 'tok', 'ext-1')).toBe(
      'wss://api.example.com/projects/p1/realtime?token=tok&clientId=ext-1'
    );
    expect(realtimeUrl('http://localhost:8787', 'p 1', 'tok', 'ext-1')).toBe(
      'ws://localhost:8787/projects/p%201/realtime?token=tok&clientId=ext-1'
    );
  });
});
