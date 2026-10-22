import {
  CloudSyncApiError,
  SNAPSHOT_MAX_PAGES_PER_TYPE,
  getProjectSnapshotAllPages,
} from '../client';
import { diffSnapshot } from '../reconcile';
import type {
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
} from '../types';

/**
 * Tests for the paginated snapshot client (scale-sync-backend, task 5.2).
 *
 * The mock server implements the pinned wire contract: page 1 (no cursor)
 * returns all five arrays plus an additive `nextCursor` map; a request WITH a
 * cursor returns only that type's next page; an undecodable/unknown cursor is
 * a 400. Cursors are encoded exactly like the backend does (base64url of
 * `{"t":<type>,"u":<updated_at>,"i":<id>}`) so requests can be verified.
 */

function installChromeStorage(initial: Record<string, unknown> = {}): void {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in store) out[k] = store[k];
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, obj);
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keysArr) delete store[k];
          cb();
        },
      },
    },
  };
}

interface FetchResult {
  status: number;
  body: unknown;
}

/** Replace global fetch; returns every requested URL for assertions. */
function installFetch(handler: (url: URL) => FetchResult): { calls: URL[] } {
  const calls: URL[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : String(input));
      calls.push(url);
      const { status, body } = handler(url);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response);
    }
  );
  return { calls };
}

interface PaginatedServerPages {
  /** Response served for the cursor-less page-1 request. */
  first: SnapshotResponse;
  /** Response served for each cursor value; missing cursor ⇒ 400. */
  byCursor: Record<string, SnapshotResponse | FetchResult>;
}

function installPaginatedServer(pages: PaginatedServerPages): { calls: URL[] } {
  return installFetch((url) => {
    const cursor = url.searchParams.get('cursor');
    if (cursor === null) return { status: 200, body: pages.first };
    const page = pages.byCursor[cursor];
    if (!page) {
      return {
        status: 400,
        body: { error: { message: 'Invalid snapshot cursor' } },
      };
    }
    return 'status' in page ? page : { status: 200, body: page };
  });
}

/** Mirror of the backend's opaque cursor codec (base64url of {t,u,i}). */
function encodeCursor(type: string, updatedAt: string, id: string): string {
  const json = JSON.stringify({ t: type, u: updatedAt, i: id });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function emptySnapshot(
  extra: Partial<SnapshotResponse> = {}
): SnapshotResponse {
  return {
    collections: [],
    links: [],
    tasks: [],
    notes: [],
    todos: [],
    ...extra,
  };
}

function ts(n: number): string {
  return `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
}

function snapLink(id: string, updatedAt: string): SnapshotLink {
  return {
    id,
    project_id: 'p1',
    collection_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    fav_icon_url: null,
    notes: null,
    tags_json: null,
    order_index: 0,
    bookmark_id: null,
  };
}

function snapCollection(id: string, updatedAt: string): SnapshotCollection {
  return {
    id,
    project_id: 'p1',
    collection_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    name: `coll-${id}`,
    description: null,
    color: null,
    minimized: 0,
    order_index: 0,
    bookmark_folder_id: null,
  };
}

function snapNote(id: string): SnapshotJsonEntity {
  return {
    id,
    project_id: 'p1',
    collection_id: null,
    updated_at: ts(1),
    deleted_at: null,
    version: 1,
    title: `note-${id}`,
    payload_json: '{"content":"x"}',
  };
}

beforeEach(() => {
  installChromeStorage({
    'cloud-sync-api-base-url': 'http://localhost:8787',
    'cloud-sync-token': 'tok',
    'cloud-sync-client-id': 'ext-test',
  });
});

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('getProjectSnapshotAllPages', () => {
  it('iterates every type cursor and merges one complete snapshot', async () => {
    const c1 = encodeCursor('links', ts(3), 'l3');
    const c2 = encodeCursor('links', ts(6), 'l6');
    const l = (n: number) => snapLink(`l${n}`, ts(n));
    const { calls } = installPaginatedServer({
      first: emptySnapshot({
        links: [l(1), l(2), l(3)],
        nextCursor: { links: c1 },
      }),
      byCursor: {
        [c1]: emptySnapshot({
          links: [l(4), l(5), l(6)],
          nextCursor: { links: c2 },
        }),
        [c2]: emptySnapshot({ links: [l(7)] }),
      },
    });

    const merged = await getProjectSnapshotAllPages('p1');

    // Complete union, in keyset order, with no leftover nextCursor.
    expect(merged).toEqual(
      emptySnapshot({ links: [l(1), l(2), l(3), l(4), l(5), l(6), l(7)] })
    );
    expect('nextCursor' in merged).toBe(false);

    // Exactly one request per page; cursors passed back verbatim.
    expect(calls).toHaveLength(3);
    expect(calls[0].pathname).toBe('/projects/p1/snapshot');
    expect(calls[0].searchParams.get('cursor')).toBeNull();
    expect(calls[1].searchParams.get('cursor')).toBe(c1);
    expect(calls[2].searchParams.get('cursor')).toBe(c2);
  });

  it('makes exactly ONE request against a server without nextCursor', async () => {
    const response = emptySnapshot({ links: [snapLink('l1', ts(1))] });
    const { calls } = installPaginatedServer({ first: response, byCursor: {} });

    const merged = await getProjectSnapshotAllPages('p1');

    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get('cursor')).toBeNull();
    expect(merged).toEqual(response);
  });

  it('paginated merge deep-equals an unbounded fetch of the same dataset', async () => {
    const c1 = encodeCursor('links', ts(2), 'l2');
    const colC1 = encodeCursor('collections', ts(2), 'c2');
    const whole = emptySnapshot({
      collections: [snapCollection('c1', ts(1)), snapCollection('c2', ts(2))],
      links: [
        snapLink('l1', ts(1)),
        snapLink('l2', ts(2)),
        snapLink('l3', ts(3)),
        snapLink('l4', ts(4)),
      ],
      notes: [snapNote('n1')],
    });

    installPaginatedServer({
      first: emptySnapshot({
        collections: [snapCollection('c1', ts(1))],
        links: [snapLink('l1', ts(1)), snapLink('l2', ts(2))],
        notes: [snapNote('n1')],
        nextCursor: { collections: colC1, links: c1 },
      }),
      byCursor: {
        [colC1]: emptySnapshot({ collections: [snapCollection('c2', ts(2))] }),
        [c1]: emptySnapshot({
          links: [snapLink('l3', ts(3)), snapLink('l4', ts(4))],
        }),
      },
    });
    const paginated = await getProjectSnapshotAllPages('p1');

    installPaginatedServer({ first: whole, byCursor: {} });
    const unbounded = await getProjectSnapshotAllPages('p1');

    expect(paginated).toEqual(unbounded);
    expect(paginated).toEqual(whole);
  });

  it('falls back to one cursor-less fetch when a cursor request returns 400', async () => {
    const c1 = encodeCursor('links', ts(1), 'l1');
    let page1Count = 0;
    let cursorRequests = 0;
    const { calls } = installFetch((url) => {
      if (url.searchParams.get('cursor') === null) {
        page1Count += 1;
        // First pass has more pages; the fallback pass is complete.
        return page1Count === 1
          ? {
              status: 200,
              body: emptySnapshot({
                links: [snapLink('l1', ts(1))],
                nextCursor: { links: c1 },
              }),
            }
          : {
              status: 200,
              body: emptySnapshot({
                links: [snapLink('l1', ts(1)), snapLink('l2', ts(2))],
              }),
            };
      }
      cursorRequests += 1;
      return {
        status: 400,
        body: { error: { message: 'Invalid snapshot cursor' } },
      };
    });

    const merged = await getProjectSnapshotAllPages('p1');

    // Restarted cursor-less: fresh page 1 becomes the whole result.
    expect(merged).toEqual(
      emptySnapshot({ links: [snapLink('l1', ts(1)), snapLink('l2', ts(2))] })
    );
    expect(cursorRequests).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[1].searchParams.get('cursor')).toBe(c1);
    expect(calls[2].searchParams.get('cursor')).toBeNull();
  });

  it('surfaces the error when the retry also rejects cursors', async () => {
    const c1 = encodeCursor('links', ts(1), 'l1');
    let cursorRequests = 0;
    installFetch((url) => {
      if (url.searchParams.get('cursor') === null) {
        return {
          status: 200,
          body: emptySnapshot({
            links: [snapLink('l1', ts(1))],
            nextCursor: { links: c1 },
          }),
        };
      }
      cursorRequests += 1;
      return { status: 400, body: { error: { message: 'nope' } } };
    });

    await expect(getProjectSnapshotAllPages('p1')).rejects.toBeInstanceOf(
      CloudSyncApiError
    );
    // One rejected cursor request per pass: initial + one fallback.
    expect(cursorRequests).toBe(2);
  });

  it('aborts at the hard page cap on a pathological looping server', async () => {
    const loopingCursor = encodeCursor('links', ts(1), 'l1');
    const { calls } = installFetch(() => ({
      status: 200,
      body: emptySnapshot({
        links: [snapLink('l1', ts(1))],
        nextCursor: { links: loopingCursor },
      }),
    }));

    await expect(getProjectSnapshotAllPages('p1')).rejects.toThrow(
      new RegExp(String(SNAPSHOT_MAX_PAGES_PER_TYPE))
    );
    // Page 1 + (cap - 1) cursor pages fetched before the guard trips.
    expect(calls).toHaveLength(SNAPSHOT_MAX_PAGES_PER_TYPE);
  });

  it('feeds the reconcile diff the complete snapshot (rows from later pages)', async () => {
    const c1 = encodeCursor('links', ts(1), 'l1');
    installPaginatedServer({
      first: emptySnapshot({
        links: [snapLink('l1', ts(1))],
        nextCursor: { links: c1 },
      }),
      byCursor: {
        [c1]: emptySnapshot({
          links: [snapLink('l2', ts(2)), snapLink('l3', ts(3))],
        }),
      },
    });
    const merged = await getProjectSnapshotAllPages('p1');

    // Empty local store: every server row must arrive as a create pull.
    const diff = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [],
      server: merged,
      queuedEntityIds: [],
    });

    const createdIds = diff.pulls
      .filter((p) => p.operation === 'create')
      .map((p) => p.entity_id)
      .sort();
    expect(createdIds).toEqual(['l1', 'l2', 'l3']);
  });
});
