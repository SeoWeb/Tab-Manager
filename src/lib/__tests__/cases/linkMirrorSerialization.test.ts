// Task 4.1 of fix-link-delete-stale-bookmark-id: mirror REMOVALS (the
// delete-side cleanup reachable from `linkActions.deleteLink` →
// `bookmarkStorage.deleteLink` → `bookmarkService.deleteBookmark`) are
// submitted to the same per-link chain as mirror moves, so an overlapping
// cross-collection move + delete for one link cannot both remove the same
// bookmark id — while the store-level link removal stays immediate.
//
// The real path runs end to end here (linkActions → linkBookmarkMirror →
// bookmarkStorage → bookmarkService) against a stubbed `global.chrome` with
// existence semantics, so `chrome.bookmarks.remove` call counts are asserted
// directly. Mocks must be declared at the top of the test file so Jest
// registers them.
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}));
jest.mock('@/lib/utils', () => ({
  preloadFavicon: jest.fn().mockResolvedValue(''),
}));
jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  enqueueCloudChange: jest.fn(),
}));
jest.mock('@/stores/appStore', () => ({
  useAppStore: { getState: jest.fn() },
}));
// `nanoid` v5 is ESM-only and untransformed under jsdom/jest — stub it with a
// deterministic id generator instead.
jest.mock('nanoid', () => ({
  nanoid: () => `test-id-${(++idCounter).toString(36)}`,
}));

let idCounter = 0;

import { showErrorToast } from '@/lib/toast';
import {
  flushLinkBookmarkMirrorsForTests,
  resetLinkBookmarkMirrorForTests,
} from '@/lib/linkBookmarkMirror';
import { createDragDropActions } from '@/stores/actions/dragDropActions';
import { createLinkActions } from '@/stores/actions/linkActions';
import type { Link } from '@/types';

const mockShowErrorToast = showErrorToast as jest.Mock;

// Real-world Chrome rejects `bookmarks.get`/`bookmarks.remove` for a missing
// id with "Can't find bookmark for id."
const CHROME_NOT_FOUND = new Error("Can't find bookmark for id.");

const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockRemove = jest.fn();

// jsdom has no chrome global; stub the bookmark APIs the move + delete paths
// touch.
const mockChrome = {
  bookmarks: {
    get: mockGet,
    create: mockCreate,
    remove: mockRemove,
  },
};

// @ts-expect-error - Mocking global chrome for testing
global.chrome = mockChrome;

function makeNode(id: string): chrome.bookmarks.BookmarkTreeNode {
  return {
    id,
    title: `Node ${id}`,
    parentId: 'folder-1',
    index: 0,
    dateAdded: Date.now(),
    dateGroupModified: Date.now(),
    url: 'https://example.com',
  } as chrome.bookmarks.BookmarkTreeNode;
}

function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    id: 'link-1',
    url: 'https://example.com',
    title: 'Example',
    favIconUrl: '',
    tags: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    order: 0,
    bookmarkId: 'bm-old',
    ...overrides,
  };
}

/**
 * Minimal store harness for the link + drag-drop actions: `set` applies the
 * reducer's returned partial to a mutable state object, mirroring zustand's
 * merge. Two collections with bookmark folders so a cross-collection move can
 * queue its mirror.
 */
function makeHarness(links: Link[]) {
  const state = {
    projects: [
      {
        id: 'project-1',
        name: 'P1',
        createdAt: new Date(),
        updatedAt: new Date(),
        collections: [
          {
            id: 'collection-1',
            name: 'C1',
            bookmarkFolderId: 'folder-1',
            links,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'collection-2',
            name: 'C2',
            bookmarkFolderId: 'folder-2',
            links: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ],
  };
  const set = (updater: (s: typeof state) => unknown) => {
    Object.assign(state, updater(state));
  };
  const get = () => state;
  const actions = {
    ...createLinkActions(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get as any
    ),
    ...createDragDropActions(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get as any
    ),
  };
  return { state, actions };
}

/**
 * Drive the real overlap: start a cross-collection move whose mirrored
 * create is held pending, let the queued move reach that create, then delete
 * the link (now in the target collection after the optimistic store move)
 * while the move's mirror write is still in flight.
 */
async function startPendingMoveAndDeleteLink(
  actions: ReturnType<typeof makeHarness>['actions']
) {
  let resolveCreate!: (node: chrome.bookmarks.BookmarkTreeNode) => void;
  mockCreate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
  );

  actions.moveLink('project-1', 'collection-1', 'link-1', 'collection-2');

  // Let the queued move reach its pending mirrored create (the create is a
  // deferred promise, so the move stays in flight across this macrotask).
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockCreate).toHaveBeenCalledTimes(1);

  actions.deleteLink('project-1', 'collection-2', 'link-1');

  return { resolveCreate };
}

describe('per-link mirror serialization: move + delete', () => {
  let unhandledRejections: unknown[];
  let onUnhandledRejection: (reason: unknown) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    resetLinkBookmarkMirrorForTests();
    mockShowErrorToast.mockClear();

    // Stubbed tree state: 'bm-old' exists until something removes it.
    const existingIds = new Set(['bm-old']);
    mockGet.mockImplementation(async (id: string) => {
      if (!existingIds.has(id)) throw CHROME_NOT_FOUND;
      return [makeNode(id)];
    });
    let createCounter = 0;
    mockCreate.mockImplementation(async () =>
      makeNode(`bm-new-${++createCounter}`)
    );
    mockRemove.mockImplementation(async (id: string) => {
      if (!existingIds.has(id)) throw CHROME_NOT_FOUND;
      existingIds.delete(id);
    });

    unhandledRejections = [];
    onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandledRejection);
    expect(unhandledRejections).toEqual([]);
  });

  it('an overlapping move + delete removes the bookmark id at most once, with no unhandled rejection', async () => {
    const { state, actions } = makeHarness([makeLink()]);
    const { resolveCreate } = await startPendingMoveAndDeleteLink(actions);

    // The removal is queued behind the in-flight move: nothing has probed or
    // touched Chrome for 'bm-old' yet.
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();

    // Complete the move: it deletes 'bm-old' itself; its bookmarkId commit
    // no-ops because the link is already gone from the store.
    resolveCreate!(makeNode('bm-new'));
    await flushLinkBookmarkMirrorsForTests();

    // The queued removal then found 'bm-old' already gone (idempotent
    // pre-check) and did NOT remove it a second time.
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('bm-old');
    expect(mockShowErrorToast).not.toHaveBeenCalled();
    expect(state.projects[0].collections[1].links).toHaveLength(0);
  });

  it('the store removal is immediate and not delayed behind the queued mirror op', async () => {
    const { state, actions } = makeHarness([makeLink()]);
    const { resolveCreate } = await startPendingMoveAndDeleteLink(actions);

    // Synchronously after deleteLink — before the in-flight move (let alone
    // the queued removal behind it) has written anything — the link is gone
    // from the UI's store…
    expect(state.projects[0].collections[0].links).toHaveLength(0);
    expect(state.projects[0].collections[1].links).toHaveLength(0);
    // …and the mirror work has not run yet.
    expect(mockRemove).not.toHaveBeenCalled();

    resolveCreate!(makeNode('bm-new'));
    await flushLinkBookmarkMirrorsForTests();

    // The mirror side completes afterwards, removing the bookmark exactly once.
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('bm-old');
  });

  it('a delete with no move in flight still removes the mirrored bookmark through the chain', async () => {
    const { state, actions } = makeHarness([makeLink()]);

    actions.deleteLink('project-1', 'collection-1', 'link-1');

    // Store removal is immediate; the mirror removal settles via the chain.
    expect(state.projects[0].collections[0].links).toHaveLength(0);
    await flushLinkBookmarkMirrorsForTests();

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('bm-old');
    expect(mockShowErrorToast).not.toHaveBeenCalled();
  });
});
