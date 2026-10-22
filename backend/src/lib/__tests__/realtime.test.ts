import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildPresenceTags,
  chunkNotification,
  notifyMembersChanged,
  parsePresenceFromTags,
  presenceSnapshot,
  ProjectRoom,
  REALTIME_CHUNK_SIZE,
  REALTIME_MAX_MESSAGE_BYTES,
  type PresenceUser,
} from '../realtime';
import type { Env, Role } from '../../types';

const u1Tags = buildPresenceTags({
  userId: 'u1',
  displayName: 'Alice',
  role: 'owner',
  clientId: 'c1',
});
const u2Tags = buildPresenceTags({
  userId: 'u2',
  displayName: 'Bob',
  role: 'viewer',
  clientId: 'c2',
});

describe('realtime presence helpers', () => {
  describe('buildPresenceTags / parsePresenceFromTags round-trip', () => {
    it('round-trips a plain ASCII identity', () => {
      const tags = buildPresenceTags({
        userId: 'user-1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'ext-abc',
      });

      const info = parsePresenceFromTags(tags);
      expect(info).toEqual({
        userId: 'user-1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'ext-abc',
      });
    });

    it('survives display names with spaces, non-ASCII, and awkward chars', () => {
      const tags = buildPresenceTags({
        userId: 'user-2',
        displayName: 'José O’Neill: admin',
        role: 'editor',
        clientId: 'ext-xyz',
      });

      const info = parsePresenceFromTags(tags);
      expect(info?.displayName).toBe('José O’Neill: admin');
      expect(info?.userId).toBe('user-2');
      expect(info?.role).toBe('editor');
    });

    it('returns null when no user tag is present', () => {
      expect(parsePresenceFromTags(['role:viewer'])).toBeNull();
      expect(parsePresenceFromTags([])).toBeNull();
      // @ts-expect-error -- guard against non-array input at runtime
      expect(parsePresenceFromTags(null)).toBeNull();
    });
  });

  describe('presenceSnapshot', () => {
    it('builds a roster from per-socket tag arrays', () => {
      expect(presenceSnapshot([u1Tags, u2Tags])).toEqual<PresenceUser[]>([
        { userId: 'u1', displayName: 'Alice', role: 'owner' },
        { userId: 'u2', displayName: 'Bob', role: 'viewer' },
      ]);
    });

    it('collapses a user connected from multiple sockets into one entry', () => {
      const c1 = buildPresenceTags({
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'c1',
      });
      const c2 = buildPresenceTags({
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'c2',
      });
      const snapshot = presenceSnapshot([c1, c2]);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].userId).toBe('u1');
    });

    it('skips sockets whose tags lack a user id', () => {
      expect(presenceSnapshot([u1Tags, ['role:viewer']])).toEqual<
        PresenceUser[]
      >([{ userId: 'u1', displayName: 'Alice', role: 'owner' }]);
    });

    it('returns an empty roster for an empty set', () => {
      expect(presenceSnapshot([])).toEqual([]);
    });

    it('attaches the editing field when provided', () => {
      const snapshot = presenceSnapshot([u1Tags], {
        u1: { entityId: 'task-1', field: 'title' },
      });
      expect(snapshot[0].editing).toEqual({
        entityId: 'task-1',
        field: 'title',
      });
    });

    it('omits editing when the user is not editing anything', () => {
      const snapshot = presenceSnapshot([u1Tags], {});
      expect(snapshot[0].editing).toBeUndefined();
    });

    it('prefers live membership role overrides over the connect-time tag', () => {
      const snapshot = presenceSnapshot([u2Tags], {}, { u2: 'editor' });
      expect(snapshot[0].role).toBe('editor');
    });
  });
});

// ---------------------------------------------------------------------------
// ProjectRoom DO: members-changed revocation + role refresh
// ---------------------------------------------------------------------------

interface MockSocket {
  sent: string[];
  closes: { code?: number; reason?: string }[];
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/**
 * Build a ProjectRoom wired to a mock hibernation registry and a mock D1
 * binding. `members` is what `SELECT user_id, role FROM project_members`
 * returns; sockets are registered the same way the runtime would after
 * `acceptWebSocket` (identity carried in hibernation tags).
 */
function makeRoomHarness(
  members: { user_id: string; role: Role }[],
  d1Failure?: Error
) {
  const sockets = new Map<MockSocket, string[]>();

  const makeSocket = (failSend?: Error): MockSocket => {
    const ws = {} as MockSocket;
    ws.sent = [];
    ws.closes = [];
    ws.send = vi.fn((frame: string) => {
      if (failSend) throw failSend;
      ws.sent.push(frame);
    });
    ws.close = vi.fn((code?: number, reason?: string) => {
      ws.closes.push({ code, reason });
      sockets.delete(ws); // closed sockets leave the runtime registry
    });
    return ws;
  };

  const accept = (
    userId: string,
    role: Role,
    clientId: string,
    options: { failSend?: Error } = {}
  ): MockSocket => {
    const ws = makeSocket(options.failSend);
    sockets.set(
      ws,
      buildPresenceTags({ userId, displayName: userId, role, clientId })
    );
    return ws;
  };

  const ctx = {
    acceptWebSocket: (ws: MockSocket, tags: string[]) => {
      sockets.set(ws, tags);
    },
    getWebSockets: () => [...sockets.keys()],
    getTags: (ws: MockSocket) => sockets.get(ws) ?? [],
    storage: { setAlarm: async () => {}, getAlarm: async () => null },
  } as unknown as DurableObjectState;

  const env = {
    D1_DATABASE: {
      prepare: () => {
        if (d1Failure) throw d1Failure;
        return {
          bind: () => ({ all: async () => ({ results: members }) }),
        };
      },
    },
  } as unknown as Env;

  const room = new ProjectRoom(ctx, env);

  const notify = (body: unknown): Promise<Response> =>
    room.fetch(
      new Request('https://project-room.local/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

  const frames = (ws: MockSocket, type: string): unknown[] =>
    ws.sent
      .map((f) => JSON.parse(f) as { type: string })
      .filter((m) => m.type === type);

  const chunkFrames = (
    ws: MockSocket
  ): { seq: number; total: number; payload: string }[] =>
    ws.sent
      .map(
        (f) =>
          JSON.parse(f) as { type: string; seq: number; total: number; payload: string }
      )
      .filter((m) => m.type === 'changes-chunk');

  return { accept, notify, frames, chunkFrames };
}

describe('ProjectRoom members-changed revocation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes a removed member while other members keep receiving fan-out', async () => {
    // u2 was removed from the project; only u1 remains in project_members.
    const { accept, notify, frames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const owner = accept('u1', 'owner', 'c1');
    const removed = accept('u2', 'editor', 'c2');

    const response = await notify({ type: 'members-changed', projectId: 'p1' });
    expect(response.status).toBe(204);

    expect(removed.close).toHaveBeenCalledWith(1008, 'Project access revoked');
    expect(owner.close).not.toHaveBeenCalled();

    // Later fan-out still reaches the owner, never the closed socket.
    await notify({ changes: [{ entity_id: 't1' }] });
    expect(frames(owner, 'changes')).toHaveLength(1);
    expect(frames(removed, 'changes')).toHaveLength(0);
  });

  it('applies a role downgrade to the live session', async () => {
    // u2 connected as editor but was downgraded to viewer since.
    const { accept, notify, frames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
      { user_id: 'u2', role: 'viewer' },
    ]);
    const owner = accept('u1', 'owner', 'c1');
    const downgraded = accept('u2', 'editor', 'c2');

    await notify({ type: 'members-changed', projectId: 'p1' });
    expect(downgraded.close).not.toHaveBeenCalled();

    // Presence is rebuilt from live membership: the role override beats the
    // stale connect-time tag.
    const presence = frames(owner, 'presence') as {
      users: PresenceUser[];
    }[];
    const u2 = presence[presence.length - 1]?.users.find(
      (u) => u.userId === 'u2'
    );
    expect(u2?.role).toBe('viewer');

    // Editor-only fan-out skips the downgraded socket but reaches the owner.
    await notify({ changes: [{ entity_id: 't1' }], minRole: 'editor' });
    expect(frames(downgraded, 'changes')).toHaveLength(0);
    expect(frames(owner, 'changes')).toHaveLength(1);
  });

  it('closes every socket of a removed user connected from multiple clients', async () => {
    const { accept, notify } = makeRoomHarness([]); // no members left
    const first = accept('u2', 'editor', 'c1');
    const second = accept('u2', 'editor', 'c2');

    await notify({ type: 'members-changed', projectId: 'p1' });

    expect(first.close).toHaveBeenCalledWith(1008, 'Project access revoked');
    expect(second.close).toHaveBeenCalledWith(1008, 'Project access revoked');
  });

  it('fails open: a D1 error during re-check disconnects nobody', async () => {
    const { accept, notify } = makeRoomHarness(
      [{ user_id: 'u1', role: 'owner' }],
      new Error('d1 unavailable')
    );
    const owner = accept('u1', 'owner', 'c1');
    const stale = accept('u2', 'viewer', 'c2');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await notify({ type: 'members-changed', projectId: 'p1' });

    expect(response.status).toBe(204);
    expect(owner.close).not.toHaveBeenCalled();
    expect(stale.close).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('rejects a members-changed payload without a projectId', async () => {
    const { accept, notify } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const owner = accept('u1', 'owner', 'c1');

    const response = await notify({ type: 'members-changed' });

    expect(response.status).toBe(400);
    expect(owner.close).not.toHaveBeenCalled();
  });
});

describe('notifyMembersChanged', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeProjectRoomEnv(
    fetchMock: (request: Request) => Promise<Response>
  ): Env {
    return {
      PROJECT_ROOM: {
        idFromName: (name: string) => `id:${name}`,
        get: () => ({ fetch: fetchMock }),
      },
    } as unknown as Env;
  }

  it('posts { type: members-changed, projectId } to the project room DO', async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      new Response(null, { status: 204 })
    );

    await notifyMembersChanged(makeProjectRoomEnv(fetchMock), 'p1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://project-room.local/notify');
    expect(await request.json()).toEqual({
      type: 'members-changed',
      projectId: 'p1',
    });
  });

  it('is a no-op without the PROJECT_ROOM binding and swallows DO errors', async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      new Response(null, { status: 204 })
    );

    // No binding (unit-test / older deploy): nothing is sent.
    await notifyMembersChanged({} as Env, 'p1');
    expect(fetchMock).not.toHaveBeenCalled();

    // A DO failure is logged, never thrown to the membership handler.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = makeProjectRoomEnv(async () => {
      throw new Error('do unreachable');
    });
    await expect(notifyMembersChanged(failing, 'p1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Chunked fan-out (scale-sync-backend 5.3)
// ---------------------------------------------------------------------------

/** A changes array whose serialized notification JSON exceeds the 512KB cap. */
function bigChanges(): unknown[] {
  return [
    {
      change_id: 'ch-1',
      entity_id: 'e1',
      entity_type: 'task',
      operation: 'update',
      patch: { blob: 'x'.repeat(600 * 1024) },
    },
  ];
}

describe('chunkNotification', () => {
  it('produces fixed-size fragments whose concatenation is the original', () => {
    const message = 'y'.repeat(REALTIME_CHUNK_SIZE * 2 + 5);
    const chunks = chunkNotification(message);
    expect(chunks.map((c) => c.length)).toEqual([
      REALTIME_CHUNK_SIZE,
      REALTIME_CHUNK_SIZE,
      5,
    ]);
    expect(chunks.join('')).toBe(message);
  });

  it('keeps a single-fragment message intact (no split under the cap)', () => {
    const message = JSON.stringify({ type: 'changes', changes: [{ id: 1 }] });
    expect(chunkNotification(message)).toEqual([message]);
  });
});

describe('ProjectRoom chunked fan-out', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('splits a >512KB notification into ordered chunks that reassemble exactly', async () => {
    const { accept, notify, frames, chunkFrames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const a = accept('u1', 'owner', 'c1');
    const b = accept('u1', 'owner', 'c2');
    const changes = bigChanges();

    const response = await notify({ changes });
    expect(response.status).toBe(204);

    for (const ws of [a, b]) {
      // No unchunked `changes` frame may ride alongside the chunks.
      expect(frames(ws, 'changes')).toHaveLength(0);

      const chunks = chunkFrames(ws);
      expect(chunks.length).toBeGreaterThan(1);
      // Frames are ordered and 1-based.
      expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i + 1));
      // Every frame agrees on the total.
      expect([...new Set(chunks.map((c) => c.total))]).toEqual([chunks.length]);

      // Client-style reassembly: concatenate fragments by seq, then parse.
      const reassembled = JSON.parse(chunks.map((c) => c.payload).join(''));
      expect(reassembled).toEqual({ type: 'changes', changes });
    }
  });

  it('keeps the exact plain changes frame at the byte threshold', async () => {
    // Pad so the serialized frame is EXACTLY REALTIME_MAX_MESSAGE_BYTES bytes
    // (ASCII payload: string length == UTF-8 byte length). At the threshold —
    // not over it — the message must keep today's shape.
    const overhead = JSON.stringify({
      type: 'changes',
      changes: [{ p: '' }],
    }).length;
    const { accept, notify, frames, chunkFrames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const owner = accept('u1', 'owner', 'c1');

    await notify({ changes: [{ p: 'x'.repeat(REALTIME_MAX_MESSAGE_BYTES - overhead) }] });

    expect(frames(owner, 'changes')).toHaveLength(1);
    expect(chunkFrames(owner)).toHaveLength(0);
  });

  it('chunks a message one byte over the threshold', async () => {
    const overhead = JSON.stringify({
      type: 'changes',
      changes: [{ p: '' }],
    }).length;
    const { accept, notify, frames, chunkFrames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const owner = accept('u1', 'owner', 'c1');

    await notify({
      changes: [{ p: 'x'.repeat(REALTIME_MAX_MESSAGE_BYTES - overhead + 1) }],
    });

    expect(frames(owner, 'changes')).toHaveLength(0);
    const chunks = chunkFrames(owner);
    expect(chunks.length).toBeGreaterThan(1);
    const reassembled = JSON.parse(chunks.map((c) => c.payload).join(''));
    expect((reassembled as { changes: unknown[] }).changes[0]).toEqual({
      p: 'x'.repeat(REALTIME_MAX_MESSAGE_BYTES - overhead + 1),
    });
  });

  it('one failing socket does not block delivery to the others', async () => {
    const { accept, notify, chunkFrames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const ok1 = accept('u1', 'viewer', 'c1');
    const bad = accept('u1', 'viewer', 'c2', {
      failSend: new Error('socket closed'),
    });
    const ok2 = accept('u2', 'viewer', 'c3');
    const changes = bigChanges();

    const response = await notify({ changes });
    expect(response.status).toBe(204);

    // Both healthy sockets receive the complete chunk set.
    for (const ws of [ok1, ok2]) {
      const chunks = chunkFrames(ws);
      expect(chunks.length).toBeGreaterThan(1);
      const reassembled = JSON.parse(chunks.map((c) => c.payload).join(''));
      expect(reassembled).toEqual({ type: 'changes', changes });
    }
    // The failing socket never accepted a frame (its first send threw).
    expect(bad.sent).toHaveLength(0);
  });

  it('respects the minRole floor for chunked notifications', async () => {
    const { accept, notify, chunkFrames } = makeRoomHarness([
      { user_id: 'u1', role: 'owner' },
    ]);
    const owner = accept('u1', 'owner', 'c1');
    const downgraded = accept('u2', 'viewer', 'c2');

    await notify({ changes: bigChanges(), minRole: 'editor' });

    const chunks = chunkFrames(owner);
    expect(chunks.length).toBeGreaterThan(1);
    expect(downgraded.sent).toHaveLength(0);
  });
});
