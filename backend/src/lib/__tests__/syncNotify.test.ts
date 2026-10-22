import { describe, it, expect, vi, afterEach } from 'vitest';
import { syncProject } from '../sync';
import type { Env, SyncMutationOutcome } from '../../types';
import { makeEnv, baseDb, NOW, type DB } from './cases/harness';

/**
 * Realtime fan-out must run OFF the request path (change `scale-sync-backend`,
 * spec "Realtime notification off the request path"):
 *
 * - a slow / hanging project room DO must not delay the sync response — the
 *   notification is scheduled via `ctx.waitUntil` and the sync answers first;
 * - a failing DO must not fail the sync, and the failure must be logged;
 * - callers without an execution context fall back to a best-effort awaited
 *   notify with the same never-fail contract.
 */

interface SyncResponseBody {
  cursor: number;
  changes: unknown[];
  conflicts: unknown[];
  outcomes: SyncMutationOutcome[];
}

function dbWithEditor(): DB {
  const db = baseDb();
  db.project_members = [
    { project_id: 'p1', user_id: 'u1', role: 'editor' },
  ];
  return db;
}

/** One create mutation, so the sync commits a change worth fanning out. */
function syncBody(): Record<string, unknown> {
  return {
    lastCursor: null,
    mutations: [
      {
        clientMutationId: 'cm-1',
        projectId: 'p1',
        clientId: 'client-1',
        createdAt: NOW,
        entityType: 'task',
        entityId: 't-new',
        operation: 'create',
        patch: { title: 'notify me' },
      },
    ],
  };
}

/** A PROJECT_ROOM binding whose DO fetch behaves per `fetchImpl`. */
function roomStub(fetchImpl: () => Promise<Response>): Env['PROJECT_ROOM'] {
  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch: fetchImpl }),
  } as unknown as Env['PROJECT_ROOM'];
}

/** ExecutionContext stub capturing every promise handed to `waitUntil`. */
function ctxStub(): { ctx: ExecutionContext; awaited: Promise<unknown>[] } {
  const awaited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      awaited.push(p);
    },
  } as unknown as ExecutionContext;
  return { ctx, awaited };
}

describe('syncProject schedules realtime fan-out off the request path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a hanging project room does not delay the 200 sync response', async () => {
    const db = dbWithEditor();
    const env = makeEnv(db);
    let releaseFetch!: () => void;
    const gate = new Promise<Response>((resolve) => {
      releaseFetch = () => resolve(new Response(null, { status: 204 }));
    });
    let fetchCalls = 0;
    env.PROJECT_ROOM = roomStub(() => {
      fetchCalls++;
      return gate;
    });
    const { ctx, awaited } = ctxStub();

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      syncBody(),
      ctx
    );

    // The sync answered while the DO fetch was still pending...
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied']);
    expect(fetchCalls).toBe(1);
    // ...and the notification was scheduled via waitUntil, not awaited.
    expect(awaited).toHaveLength(1);
    let settled = false;
    void awaited[0]!.then(() => {
      settled = true;
    });
    await Promise.resolve(); // a microtask tick cannot settle the gated fetch
    expect(settled).toBe(false);

    // The scheduled notification still completes once the room answers.
    releaseFetch();
    await awaited[0];
  });

  it('a throwing project room does not fail the sync and the failure is logged', async () => {
    const db = dbWithEditor();
    const env = makeEnv(db);
    env.PROJECT_ROOM = roomStub(() =>
      Promise.reject(new Error('room exploded'))
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, awaited } = ctxStub();

    const response = await syncProject(
      env,
      { id: 'u1' },
      'p1',
      syncBody(),
      ctx
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied']);
    expect(awaited).toHaveLength(1);
    await awaited[0]; // the scheduled promise must not reject
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/notify failed/);

    // The sync result itself was committed durably before the fan-out.
    expect(db.tasks.some((t) => t.id === 't-new')).toBe(true);
    expect(db.sync_changes).toHaveLength(1);
  });

  it('without an execution context the fallback awaits and still never fails the sync', async () => {
    const db = dbWithEditor();
    const env = makeEnv(db);
    env.PROJECT_ROOM = roomStub(() =>
      Promise.reject(new Error('room exploded'))
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await syncProject(env, { id: 'u1' }, 'p1', syncBody());

    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied']);
    expect(errorSpy).toHaveBeenCalled();
  });
});
