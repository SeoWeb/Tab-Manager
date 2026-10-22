import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SNAPSHOT_PAGE_SIZE,
  decodeSnapshotCursor,
  encodeSnapshotCursor,
  getProjectSnapshot,
  InvalidSnapshotCursorError,
  resolveSnapshotPageSize,
} from '../snapshot';
import { handleSnapshotRequest } from '../../index';
import type {
  Env,
  SnapshotEntityTypeName,
  SnapshotLink,
  SnapshotResponse,
} from '../../types';

// Snapshot-specific D1 mock: honors exactly the SQL shape
// `fetchSnapshotTable` issues (FROM <table> t ... ORDER BY t.updated_at ASC,
// t.id ASC [keyset] LIMIT ?), so pagination semantics — ordering, keyset
// continuation, page bounds — are exercised for real. (The shared
// `cases/harness.ts` mock returns empty results for plain SELECTs and is
// aimed at the sync engine's statements, so it can't drive these queries.)

interface SeedRow {
  id: string;
  project_id: string;
  updated_at: string;
  deleted_at: string | null;
  [k: string]: unknown;
}

interface SeedData {
  collections: SeedRow[];
  links: SeedRow[];
  tasks: SeedRow[];
  notes: SeedRow[];
  todos: SeedRow[];
  entity_versions: {
    project_id: string;
    entity_type: string;
    entity_id: string;
    version: number;
  }[];
}

const TABLE_ENTITY_TYPES: Record<SnapshotEntityTypeName, string> = {
  collections: 'collection',
  links: 'link',
  tasks: 'task',
  notes: 'note',
  todos: 'todo',
};

function makeEnv(data: SeedData, vars: Record<string, string> = {}): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all() {
              const match = sql.match(
                /FROM (collections|links|tasks|notes|todos) t/
              );
              if (
                !match ||
                !sql.includes('ORDER BY t.updated_at ASC, t.id ASC')
              ) {
                return { results: [] };
              }
              const type = match[1] as SnapshotEntityTypeName;
              const projectId = params[1] as string;
              const limit = Number(params[params.length - 1]);

              const withVersions = (data[type] as SeedRow[])
                .filter((r) => r.project_id === projectId)
                .map((r) => ({
                  ...r,
                  version:
                    data.entity_versions.find(
                      (ev) =>
                        ev.project_id === projectId &&
                        ev.entity_type === TABLE_ENTITY_TYPES[type] &&
                        ev.entity_id === r.id
                    )?.version ?? 1,
                }));

              let rows = withVersions;
              if (sql.includes('t.updated_at > ?')) {
                // Bindings: [entityType, projectId, u, u, i, limit]
                const u = params[2] as string;
                const i = params[4] as string;
                rows = rows.filter(
                  (r) =>
                    r.updated_at > u || (r.updated_at === u && r.id > i)
                );
              }
              // Lexicographic (updated_at, id) ordering — matches SQLite TEXT
              // ordering for ISO-8601 timestamps.
              rows.sort((a, b) => {
                if (a.updated_at !== b.updated_at) {
                  return a.updated_at < b.updated_at ? -1 : 1;
                }
                if (a.id !== b.id) return a.id < b.id ? -1 : 1;
                return 0;
              });
              return { results: rows.slice(0, limit) };
            },
          };
        },
      };
    },
  };
  return { D1_DATABASE: db, ...vars } as unknown as Env;
}

/** Links spread over 28 distinct updated_at values → plenty of (u, i) ties. */
function linkRow(i: number): SeedRow {
  const day = String(1 + (i % 28)).padStart(2, '0');
  return {
    id: `l${String(i).padStart(5, '0')}`,
    project_id: 'p1',
    collection_id: 'c1',
    url: `https://example.com/${i}`,
    title: `Link ${i}`,
    fav_icon_url: null,
    notes: null,
    tags_json: null,
    order_index: i,
    bookmark_id: null,
    updated_at: `2020-01-${day}T00:00:00.000Z`,
    deleted_at: null,
  };
}

function bigSeed(linkCount: number): SeedData {
  return {
    collections: [],
    links: Array.from({ length: linkCount }, (_, i) => linkRow(i)),
    tasks: [],
    notes: [],
    todos: [],
    entity_versions: [
      {
        project_id: 'p1',
        entity_type: 'link',
        entity_id: 'l00000',
        version: 9,
      },
    ],
  };
}

function smallSeed(): SeedData {
  return {
    collections: [
      {
        id: 'c1',
        project_id: 'p1',
        name: 'One',
        deleted_at: null,
        updated_at: '2020-02-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        project_id: 'p1',
        name: 'Two',
        deleted_at: '2021-01-01T00:00:00.000Z',
        updated_at: '2020-02-02T00:00:00.000Z',
      },
    ],
    links: Array.from({ length: 120 }, (_, i) => linkRow(i)),
    tasks: [
      {
        id: 't1',
        project_id: 'p1',
        title: 'T1',
        payload_json: '{}',
        deleted_at: null,
        updated_at: '2020-03-01T00:00:00.000Z',
      },
      {
        id: 't2',
        project_id: 'p1',
        title: 'T2',
        payload_json: '{}',
        deleted_at: null,
        updated_at: '2020-03-01T00:00:00.000Z',
      },
    ],
    notes: [
      {
        id: 'n1',
        project_id: 'p1',
        title: 'N1',
        payload_json: '{}',
        deleted_at: null,
        updated_at: '2020-04-01T00:00:00.000Z',
      },
    ],
    todos: [
      {
        id: 'd1',
        project_id: 'p1',
        title: 'D1',
        payload_json: '{}',
        deleted_at: null,
        updated_at: '2020-05-01T00:00:00.000Z',
      },
    ],
    entity_versions: [
      {
        project_id: 'p1',
        entity_type: 'collection',
        entity_id: 'c1',
        version: 4,
      },
      {
        project_id: 'p1',
        entity_type: 'task',
        entity_id: 't2',
        version: 6,
      },
    ],
  };
}

/** Client-style iteration: follow `nextCursor.links` until it disappears. */
async function collectAllLinks(
  env: Env,
  pageSize?: string
): Promise<SnapshotResponse[]> {
  const pages: SnapshotResponse[] = [];
  let response = await getProjectSnapshot(
    env,
    'p1',
    pageSize ? { pageSize } : undefined
  );
  pages.push(response);
  let cursor = response.nextCursor?.links;
  let guard = 0;
  while (cursor) {
    if (++guard > 10_000) throw new Error('pagination did not terminate');
    response = await getProjectSnapshot(env, 'p1', { cursor, pageSize });
    pages.push(response);
    cursor = response.nextCursor?.links;
  }
  return pages;
}

const byId = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe('snapshot cursor codec', () => {
  it('round-trips (type, updated_at, id) through base64url', () => {
    const cursor = encodeSnapshotCursor(
      'links',
      '2020-01-01T00:00:00.000Z',
      'l00042'
    );
    expect(cursor).not.toMatch(/[+/=]/); // URL-safe alphabet, no padding
    expect(decodeSnapshotCursor(cursor)).toEqual({
      t: 'links',
      u: '2020-01-01T00:00:00.000Z',
      i: 'l00042',
    });
  });

  it('carries exactly the pinned JSON shape {"t","u","i"}', () => {
    const cursor = encodeSnapshotCursor(
      'links',
      '2020-06-15T10:00:00.000Z',
      'link-42'
    );
    const json = atob(
      cursor.replace(/-/g, '+').replace(/_/g, '/')
    );
    expect(JSON.parse(json)).toEqual({
      t: 'links',
      u: '2020-06-15T10:00:00.000Z',
      i: 'link-42',
    });
  });

  it('rejects bad base64, non-JSON, unknown types, and missing fields', () => {
    expect(decodeSnapshotCursor('!!!not base64!!!')).toBeNull();

    const notJson = btoa('just some text').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeSnapshotCursor(notJson)).toBeNull();

    const unknownType = btoa(JSON.stringify({ t: 'widgets', u: 'u', i: 'i' }));
    expect(decodeSnapshotCursor(unknownType)).toBeNull();

    const missingFields = btoa(JSON.stringify({ t: 'links', u: 'u' }));
    expect(decodeSnapshotCursor(missingFields)).toBeNull();

    const nonString = btoa(JSON.stringify({ t: 'links', u: 5, i: 'i' }));
    expect(decodeSnapshotCursor(nonString)).toBeNull();
  });
});

describe('snapshot pagination — 5,000-link project', () => {
  it('iterates cursors until exhaustion (pageSize 100); union == full fetch', async () => {
    const data = bigSeed(5000);
    const env = makeEnv(data);

    const pages = await collectAllLinks(env, '100');
    expect(pages).toHaveLength(50);

    // Page 1 carries the (uncapped) other types; continuation pages are
    // links-only: the other four arrays are empty.
    expect(pages[0].collections).toEqual([]);
    expect(pages[0].tasks).toEqual([]);
    expect(pages[0].notes).toEqual([]);
    expect(pages[0].todos).toEqual([]);
    for (const page of pages.slice(1)) {
      expect(page.collections).toEqual([]);
      expect(page.tasks).toEqual([]);
      expect(page.notes).toEqual([]);
      expect(page.todos).toEqual([]);
    }
    for (const page of pages) {
      expect(page.links.length).toBeLessThanOrEqual(100);
      expect(page.links.length).toBeGreaterThan(0);
    }

    const ids = pages.flatMap((p) => p.links.map((l) => l.id));
    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(
      data.links.map((l) => l.id as string).sort()
    );
  });

  it('paginates at the default 500 cap — multi-page, union == full fetch', async () => {
    const data = bigSeed(5000);
    const env = makeEnv(data);

    const first = await getProjectSnapshot(env, 'p1');
    expect(first.links).toHaveLength(DEFAULT_SNAPSHOT_PAGE_SIZE);
    // Only the type with more rows appears in the continuation map.
    expect(Object.keys(first.nextCursor ?? {})).toEqual(['links']);

    const pages = await collectAllLinks(env);
    expect(pages).toHaveLength(10);
    const ids = pages.flatMap((p) => p.links.map((l) => l.id));
    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(
      data.links.map((l) => l.id as string).sort()
    );
  });

  it('orders pages strictly by (updated_at ASC, id ASC)', async () => {
    const env = makeEnv(bigSeed(1000));
    const pages = await collectAllLinks(env, '200');
    const rows = pages.flatMap((p) => p.links);
    for (let i = 1; i < rows.length; i++) {
      const prev: SnapshotLink = rows[i - 1];
      const cur: SnapshotLink = rows[i];
      expect(
        prev.updated_at < cur.updated_at ||
          (prev.updated_at === cur.updated_at && prev.id < cur.id)
      ).toBe(true);
    }
  });
});

describe('paginated reconcile == unbounded reconcile', () => {
  it('assembled pages deep-equal a full no-cursor snapshot (versions included)', async () => {
    const env = makeEnv(smallSeed());

    // Full fetch: 120 links + mixed others, everything under the default cap.
    const full = await getProjectSnapshot(env, 'p1');
    expect(full.nextCursor).toBeUndefined();

    // Paginated fetch: iterate links at pageSize 50, assemble client-style.
    const pages = await collectAllLinks(env, '50');
    expect(pages.length).toBeGreaterThan(1);
    const assembled = {
      collections: pages[0].collections,
      links: pages.flatMap((p) => p.links),
      tasks: pages[0].tasks,
      notes: pages[0].notes,
      todos: pages[0].todos,
    };

    expect(byId(assembled.collections)).toEqual(byId(full.collections));
    expect(byId(assembled.links)).toEqual(byId(full.links));
    expect(byId(assembled.tasks)).toEqual(byId(full.tasks));
    expect(byId(assembled.notes)).toEqual(byId(full.notes));
    expect(byId(assembled.todos)).toEqual(byId(full.todos));

    // Versions ride along on both paths.
    expect(assembled.links.every((l) => typeof l.version === 'number')).toBe(
      true
    );
    expect(assembled.collections.find((c) => c.id === 'c1')?.version).toBe(4);
    expect(assembled.tasks.find((t) => t.id === 't2')?.version).toBe(6);
  });

  it('keeps soft-deleted rows and version joins across page boundaries', async () => {
    const data = bigSeed(300);
    data.links[10].deleted_at = '2021-06-01T00:00:00.000Z'; // lands on page 1
    data.links[250].deleted_at = '2021-06-01T00:00:00.000Z'; // lands on page 2
    const env = makeEnv(data);

    const pages = await collectAllLinks(env, '200');
    const rows = pages.flatMap((p) => p.links);
    const deleted = rows.filter((r) => r.deleted_at !== null);
    expect(deleted.map((r) => r.id).sort()).toEqual(['l00010', 'l00250']);
    expect(rows.find((r) => r.id === 'l00000')?.version).toBe(9);
  });
});

describe('keyset continuation', () => {
  it('resumes from the strict (updated_at, id) pair when the cursor row is gone', async () => {
    const data = bigSeed(250);
    const env = makeEnv(data);
    const originalIds = data.links.map((l) => l.id as string);

    const first = await getProjectSnapshot(env, 'p1', { pageSize: '100' });
    expect(first.links).toHaveLength(100);
    const cursor = first.nextCursor?.links;
    expect(cursor).toBeDefined();
    const decoded = decodeSnapshotCursor(cursor!);
    expect(decoded?.t).toBe('links');
    // The cursor row is the LAST row of page 1 (still served to the client).
    expect(first.links.at(-1)?.id).toBe(decoded!.i);

    // The cursor row disappears before the next page is fetched — keyset
    // pagination needs no lookup and must resume from the strict comparison.
    data.links = data.links.filter((l) => l.id !== decoded!.i);

    const second = await getProjectSnapshot(env, 'p1', { cursor, pageSize: '100' });
    const page1Ids = first.links.map((l) => l.id);
    const rest = second.links.map((l) => l.id);
    // The deleted row is never re-served after page 1...
    expect(rest).not.toContain(decoded!.i);
    // ...and nothing before it is re-served either.
    expect(rest.some((id) => page1Ids.includes(id))).toBe(false);

    let next = second.nextCursor?.links;
    let guard = 0;
    while (next) {
      if (++guard > 100) throw new Error('pagination did not terminate');
      const page = await getProjectSnapshot(env, 'p1', {
        cursor: next,
        pageSize: '100',
      });
      rest.push(...page.links.map((l) => l.id));
      next = page.nextCursor?.links;
    }

    const all = [...page1Ids, ...rest];
    // No duplicates and no skips: the union of served pages is exactly the
    // ORIGINAL row set (page 1 legitimately contains the since-deleted row;
    // every surviving row appears exactly once, in keyset order).
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(originalIds));
  });

  it('returns an empty page for a cursor pointing past the last row', async () => {
    const env = makeEnv(bigSeed(150));
    // A hand-crafted (or over-iterated) cursor beyond every row: the type's
    // page comes back empty, the other arrays are empty, no nextCursor.
    const spentCursor = encodeSnapshotCursor(
      'links',
      '9999-12-31T23:59:59.999Z',
      'zzzz'
    );
    const page = await getProjectSnapshot(env, 'p1', {
      cursor: spentCursor,
      pageSize: '100',
    });
    expect(page.links).toEqual([]);
    expect(page.collections).toEqual([]);
    expect(page.tasks).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('page size resolution', () => {
  const data = () => bigSeed(1200);

  it('lets pageSize lower the cap, never raise it', async () => {
    const env = makeEnv(data());
    const lowered = await getProjectSnapshot(env, 'p1', { pageSize: '100' });
    expect(lowered.links).toHaveLength(100);
    expect(Object.keys(lowered.nextCursor ?? {})).toEqual(['links']);

    const raised = await getProjectSnapshot(env, 'p1', { pageSize: '99999' });
    expect(raised.links).toHaveLength(DEFAULT_SNAPSHOT_PAGE_SIZE);
  });

  it('clamps the SNAPSHOT_PAGE_SIZE env cap to 1..2000 and falls back to 500', () => {
    expect(resolveSnapshotPageSize(makeEnv(data()), null)).toBe(500);
    expect(
      resolveSnapshotPageSize(makeEnv(data(), { SNAPSHOT_PAGE_SIZE: '100000' }), null)
    ).toBe(2000);
    expect(
      resolveSnapshotPageSize(makeEnv(data(), { SNAPSHOT_PAGE_SIZE: '0' }), null)
    ).toBe(1);
    expect(
      resolveSnapshotPageSize(makeEnv(data(), { SNAPSHOT_PAGE_SIZE: 'abc' }), null)
    ).toBe(500);
    // Invalid request values leave the cap untouched.
    expect(resolveSnapshotPageSize(makeEnv(data()), 'abc')).toBe(500);
    expect(resolveSnapshotPageSize(makeEnv(data()), '-5')).toBe(500);
  });

  it('a project under the (env-raised) cap gets no nextCursor at all', async () => {
    const env = makeEnv(data(), { SNAPSHOT_PAGE_SIZE: '2000' });
    const snapshot = await getProjectSnapshot(env, 'p1');
    expect(snapshot.links).toHaveLength(1200);
    expect(snapshot.nextCursor).toBeUndefined();
  });
});

describe('invalid cursors', () => {
  it('throws InvalidSnapshotCursorError from getProjectSnapshot', async () => {
    const env = makeEnv(smallSeed());
    await expect(
      getProjectSnapshot(env, 'p1', { cursor: 'not-a-cursor' })
    ).rejects.toBeInstanceOf(InvalidSnapshotCursorError);

    const trailingGarbage = encodeSnapshotCursor('links', 'u', 'i') + '%%';
    await expect(
      getProjectSnapshot(env, 'p1', { cursor: trailingGarbage })
    ).rejects.toBeInstanceOf(InvalidSnapshotCursorError);

    const unknownType = btoa(JSON.stringify({ t: 'aliens', u: 'u', i: 'x' }));
    await expect(
      getProjectSnapshot(env, 'p1', { cursor: unknownType })
    ).rejects.toBeInstanceOf(InvalidSnapshotCursorError);
  });

  it('route maps an invalid cursor to 400 with a reconcile hint and no echo', async () => {
    const env = makeEnv(smallSeed());
    const secret = encodeSnapshotCursor(
      'links',
      '2020-01-01T00:00:00.000Z',
      'l-secret-id'
    );

    const response = await handleSnapshotRequest(
      env,
      'p1',
      'garbage-cursor-value',
      '50'
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('reconcile');
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('garbage-cursor-value');
    expect(wire).not.toContain('l-secret-id');

    const unknownType = btoa(JSON.stringify({ t: 'aliens', u: 'u', i: 'x' }));
    const r2 = await handleSnapshotRequest(env, 'p1', unknownType, null);
    expect(r2.status).toBe(400);
    const body2 = (await r2.json()) as { error: { message: string } };
    expect(body2.error.message).toContain('reconcile');
  });

  it('route serves a page for a valid cursor (200, links-only)', async () => {
    const env = makeEnv(smallSeed());
    const cursor = encodeSnapshotCursor(
      'links',
      '2020-01-01T00:00:00.000Z',
      'l00000'
    );
    const ok = await handleSnapshotRequest(env, 'p1', cursor, '50');
    expect(ok.status).toBe(200);
    const page = (await ok.json()) as SnapshotResponse;
    expect(page.links.length).toBeGreaterThan(0);
    expect(page.links.length).toBeLessThanOrEqual(50);
    expect(page.collections).toEqual([]);
    expect(page.tasks).toEqual([]);
  });
});
