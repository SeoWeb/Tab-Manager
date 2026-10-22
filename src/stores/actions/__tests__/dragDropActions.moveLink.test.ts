// Task 4.5 (cleanup-and-regression-tests): `moveLink`'s bookmark mirroring
// must be sequenced with the state it records — no detached fire-and-forget
// writes inside the state updater, and no failure path that leaves
// `bookmarkId` silently referring to the wrong (or a nonexistent) bookmark.
//
// The store harness is minimal (zustand-style set/get over a plain object):
// the real appStore pulls in ESM-only nanoid and every Chrome service. The
// harness `updateLink` replicates the real action's merge behaviour for the
// only shape the mirror commits ({ bookmarkId } with isInternalCall = true,
// i.e. no cloud enqueue and no bookmark title/url echo).

jest.mock('@/lib/bookmarkStorage', () => ({
  bookmarkStorage: {
    createLink: jest.fn(),
    deleteLink: jest.fn(),
    moveBookmark: jest.fn(),
  },
}));
jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  enqueueCloudChange: jest.fn(),
}));

import { bookmarkStorage } from '@/lib/bookmarkStorage';
import {
  flushLinkBookmarkMirrorsForTests,
  resetLinkBookmarkMirrorForTests,
  setLinkBookmarkMirrorRetryDelayForTests,
} from '@/lib/linkBookmarkMirror';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { createDragDropActions } from '@/stores/actions/dragDropActions';
import type { AppState } from '@/stores/types';
import type { Collection, Link, Project } from '@/types';

const mockBookmarkStorage = bookmarkStorage as jest.Mocked<
  typeof bookmarkStorage
>;
const mockEnqueue = enqueueCloudChange as jest.MockedFunction<
  typeof enqueueCloudChange
>;

const NOW = new Date('2026-01-01T00:00:00Z');

function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    id: 'link-1',
    url: 'https://example.com',
    title: 'Example',
    createdAt: NOW,
    updatedAt: NOW,
    order: 0,
    bookmarkId: 'b-old',
    ...overrides,
  };
}

function makeCollection(id: string, links: Link[]): Collection {
  return {
    id,
    name: id.toUpperCase(),
    links,
    createdAt: NOW,
    updatedAt: NOW,
    bookmarkFolderId: `folder-${id}`,
  };
}

function makeProject(collections: Collection[]): Project[] {
  return [
    {
      id: 'proj-1',
      name: 'P1',
      collections,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
}

let events: string[] = [];
let bookmarkSeq = 0;

/**
 * Minimal live-store harness; `updateLink` is seeded into the state so the
 * mirror's `commitBookmarkId` callback can reach it via `get()`.
 */
function makeHarness(projects: Project[]) {
  let state = { projects } as unknown as AppState;
  const get = (): AppState => state;
  const set = (
    updater: ((s: AppState) => AppState | Partial<AppState>) | Partial<AppState>
  ): void => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial } as AppState;
  };
  const updateLink: AppState['updateLink'] = (
    projectId,
    collectionId,
    linkId,
    updates
  ) => {
    if (updates.bookmarkId !== undefined) {
      events.push(`commit:${updates.bookmarkId}`);
    }
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              collections: p.collections.map((c) =>
                c.id !== collectionId
                  ? c
                  : {
                      ...c,
                      links: c.links.map((l) =>
                        l.id === linkId
                          ? { ...l, ...updates, updatedAt: new Date() }
                          : l
                      ),
                    }
              ),
            }
      ),
    }));
  };
  state = { ...state, updateLink };
  const actions = createDragDropActions(set, get);
  return { actions, get };
}

function linkIn(get: () => AppState, collectionId: string): Link | undefined {
  return get()
    .projects.find((p) => p.id === 'proj-1')
    ?.collections.find((c) => c.id === collectionId)
    ?.links.find((l) => l.id === 'link-1');
}

describe('moveLink bookmark mirroring', () => {
  beforeEach(() => {
    // reset (not clear) so mock implementations never leak between cases.
    jest.resetAllMocks();
    resetLinkBookmarkMirrorForTests();
    // Store-level tests cannot pass retryDelayMs per request; keep retries on
    // the microtask queue so no fake timers are needed.
    setLinkBookmarkMirrorRetryDelayForTests(0);
    events = [];
    bookmarkSeq = 0;

    mockBookmarkStorage.createLink.mockImplementation(
      (linkTitle: string, linkUrl: string, collectionFolderId: string) => {
        const id = `b-new-${(bookmarkSeq += 1)}`;
        events.push(`create:${id}@${collectionFolderId}`);
        return Promise.resolve({
          id,
          title: linkTitle,
          url: linkUrl,
        } as chrome.bookmarks.BookmarkTreeNode);
      }
    );
    mockBookmarkStorage.deleteLink.mockImplementation((linkId: string) => {
      events.push(`delete:${linkId}`);
      return Promise.resolve();
    });
    mockBookmarkStorage.moveBookmark.mockResolvedValue({
      id: 'moved',
      title: 'Example',
      url: 'https://example.com',
    } as chrome.bookmarks.BookmarkTreeNode);
  });

  it('success path: moves the link, mirrors the bookmark in sequence, and commits the new id', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
      ])
    );

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    await flushLinkBookmarkMirrorsForTests();

    // Optimistic move is committed…
    expect(linkIn(get, 'col-a')).toBeUndefined();
    expect(linkIn(get, 'col-b')).toMatchObject({ order: 0 });
    // …and the mirror ran create → delete → state commit, in order.
    expect(mockBookmarkStorage.createLink).toHaveBeenCalledWith(
      'Example',
      'https://example.com',
      'folder-col-b'
    );
    expect(events).toEqual([
      'create:b-new-1@folder-col-b',
      'delete:b-old',
      'commit:b-new-1',
    ]);
    expect(linkIn(get, 'col-b')?.bookmarkId).toBe('b-new-1');

    // The move's cloud patch is unchanged by the mirroring work — and the
    // bookmarkId commit (isInternalCall) never leaks into a cloud patch.
    const calls = mockEnqueue.mock.calls.map((call) => call[0]);
    expect(calls).toContainEqual(
      expect.objectContaining({
        projectId: 'proj-1',
        entityType: 'link',
        entityId: 'link-1',
        operation: 'update',
        patch: { collectionId: 'col-b', order: 0 },
      })
    );
    for (const call of calls) {
      expect(call.patch).not.toHaveProperty('bookmarkId');
    }
  });

  it('create failure: the link still moves, but the old bookmarkId is kept — no divergent id', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
      ])
    );
    mockBookmarkStorage.createLink.mockRejectedValue(
      new Error('chrome unavailable')
    );
    const errorSpy = jest.spyOn(console, 'error');

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    await flushLinkBookmarkMirrorsForTests();

    // End state per the chosen convention: the optimistic collection move
    // stands, and `bookmarkId` still holds the OLD correct value — it refers
    // to the bookmark that was never deleted and still mirrors this link.
    expect(linkIn(get, 'col-b')).toMatchObject({ bookmarkId: 'b-old' });
    expect(mockBookmarkStorage.deleteLink).not.toHaveBeenCalled();
    // The failure was handled explicitly (bounded retry + reported), not
    // silently swallowed.
    expect(mockBookmarkStorage.createLink).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping the existing bookmarkId'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('delete failure after a successful create: compensates the fresh bookmark and keeps the old id', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
      ])
    );
    mockBookmarkStorage.deleteLink.mockImplementation((linkId: string) => {
      events.push(`delete:${linkId}`);
      return linkId === 'b-old'
        ? Promise.reject(new Error('delete refused'))
        : Promise.resolve();
    });
    const errorSpy = jest.spyOn(console, 'error');

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    await flushLinkBookmarkMirrorsForTests();

    // The half-completed move was rolled back Chrome-side: the fresh bookmark
    // was removed again (no orphan duplicate), so `b-old` remains the one real
    // mirror and the state never recorded the new id.
    expect(mockBookmarkStorage.deleteLink).toHaveBeenCalledWith('b-new-1');
    expect(linkIn(get, 'col-b')).toMatchObject({ bookmarkId: 'b-old' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping the existing bookmarkId'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('retry path: a transient create failure converges on the second attempt', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
      ])
    );
    // First attempt fails before the create impl runs (so the sequence counter
    // is untouched); spell out the second create explicitly for a stable id.
    mockBookmarkStorage.createLink
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementationOnce(
        (_linkTitle: string, linkUrl: string, collectionFolderId: string) => {
          events.push(`create:b-new-2@${collectionFolderId}`);
          return Promise.resolve({
            id: 'b-new-2',
            title: 'Example',
            url: linkUrl,
          } as chrome.bookmarks.BookmarkTreeNode);
        }
      );

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    await flushLinkBookmarkMirrorsForTests();

    expect(mockBookmarkStorage.createLink).toHaveBeenCalledTimes(2);
    expect(mockBookmarkStorage.deleteLink).toHaveBeenCalledTimes(1);
    expect(mockBookmarkStorage.deleteLink).toHaveBeenCalledWith('b-old');
    expect(linkIn(get, 'col-b')).toMatchObject({ bookmarkId: 'b-new-2' });
    // The first attempt failed before any bookmark write; the retry created a
    // fresh bookmark, deleted the old one, and only then committed the id.
    expect(events).toEqual([
      'create:b-new-2@folder-col-b',
      'delete:b-old',
      'commit:b-new-2',
    ]);
  });

  it('concurrent moveLink calls for one link serialize their mirror ops instead of interleaving', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
        makeCollection('col-c', []),
      ])
    );

    // Two moves submitted in the same tick, before any mirror write ran.
    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    actions.moveLink('proj-1', 'col-b', 'link-1', 'col-c');
    await flushLinkBookmarkMirrorsForTests();

    // Strict per-link ordering: op 1 fully completed (create, delete, commit)
    // before op 2 started, and op 2 late-bound the id op 1 had committed —
    // not the stale `b-old` it observed at submission time.
    expect(events).toEqual([
      'create:b-new-1@folder-col-b',
      'delete:b-old',
      'commit:b-new-1',
      'create:b-new-2@folder-col-c',
      'delete:b-new-1',
      'commit:b-new-2',
    ]);
    // Converged: the link's mirror is the second creation, and every earlier
    // bookmark (b-old and the first creation) was deleted — no orphans, no
    // divergent id.
    expect(linkIn(get, 'col-c')).toMatchObject({ bookmarkId: 'b-new-2' });
    expect(mockBookmarkStorage.deleteLink.mock.calls.map((c) => c[0])).toEqual([
      'b-old',
      'b-new-1',
    ]);
  });

  it('a link without a bookmark is moved without queueing any mirror op', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink({ bookmarkId: null })]),
        makeCollection('col-b', []),
      ])
    );

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-b');
    await flushLinkBookmarkMirrorsForTests();

    expect(mockBookmarkStorage.createLink).not.toHaveBeenCalled();
    expect(mockBookmarkStorage.deleteLink).not.toHaveBeenCalled();
    expect(linkIn(get, 'col-b')).toMatchObject({ bookmarkId: null });
    expect(events).toEqual([]);
  });

  it('a same-collection moveLink is a rejected no-op and queues no mirror', async () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [makeLink()]),
        makeCollection('col-b', []),
      ])
    );

    actions.moveLink('proj-1', 'col-a', 'link-1', 'col-a');
    await flushLinkBookmarkMirrorsForTests();

    expect(mockBookmarkStorage.createLink).not.toHaveBeenCalled();
    expect(mockBookmarkStorage.deleteLink).not.toHaveBeenCalled();
    expect(linkIn(get, 'col-a')).toMatchObject({ bookmarkId: 'b-old' });
  });

  it('reorderLinks still relocates the bookmark within the folder, outside the state updater', () => {
    const { actions, get } = makeHarness(
      makeProject([
        makeCollection('col-a', [
          makeLink({ id: 'link-1', bookmarkId: 'b-1' }),
          makeLink({ id: 'link-2', bookmarkId: 'b-2' }),
        ]),
        makeCollection('col-b', []),
      ])
    );

    actions.reorderLinks('proj-1', 'col-a', 'link-2', 'link-1');

    // The reordered link lands at the index of the link it was dropped onto.
    expect(mockBookmarkStorage.moveBookmark).toHaveBeenCalledWith('b-2', {
      index: 0,
    });
    expect(
      get()
        .projects.find((p) => p.id === 'proj-1')
        ?.collections.find((c) => c.id === 'col-a')
        ?.links.map((l) => l.id)
    ).toEqual(['link-2', 'link-1']);
  });
});
