// Tasks 1.1–1.3 of fix-link-delete-stale-bookmark-id:
// - `bookmarkService.deleteBookmark` / `deleteBookmarkTree` are idempotent: a
//   bookmark id that is already absent from the tree resolves as success (no
//   Chrome remove call, no error toast); only unrelated remove failures still
//   propagate to the toast path.
// - The full link-delete path (`linkActions.deleteLink` →
//   `bookmarkStorage.deleteLink` → `bookmarkService.deleteBookmark`) and the
//   `linkSync` orphan-cleanup path surface NO error toast when the mirrored
//   bookmark is gone.
//
// The bookmark service runs for real here against a stubbed `global.chrome`,
// and the toast module is mocked so `showErrorToast` calls can be asserted.
// Mocks must be declared at the top of the test file so Jest registers them.
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

import { bookmarkService } from '../../bookmarkService';
import { LinkSync } from '../../sync/linkSync';
import { createLinkActions } from '@/stores/actions/linkActions';
import { showErrorToast } from '@/lib/toast';
import { useAppStore } from '@/stores/appStore';
import type { Link } from '@/types';

const mockShowErrorToast = showErrorToast as jest.Mock;

// Real-world Chrome rejects `bookmarks.get` for a missing id with
// "Can't find bookmark for id." — the same rejection `remove` produces.
const CHROME_NOT_FOUND = new Error("Can't find bookmark for id.");

const mockGet = jest.fn();
const mockRemove = jest.fn();
const mockRemoveTree = jest.fn();

// jsdom has no chrome global; stub the bookmark APIs the delete path touches.
const mockChrome = {
  bookmarks: {
    get: mockGet,
    remove: mockRemove,
    removeTree: mockRemoveTree,
  },
};

// @ts-expect-error - Mocking global chrome for testing
global.chrome = mockChrome;

function makeNode(id: string): chrome.bookmarks.BookmarkTreeNode {
  return {
    id,
    title: `Node ${id}`,
    parentId: 'parent-1',
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
    bookmarkId: 'bm-1',
    ...overrides,
  };
}

/**
 * Minimal store harness for `createLinkActions`: `set` applies the reducer's
 * returned partial to a mutable state object, mirroring zustand's merge.
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
            links,
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
  const actions = createLinkActions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get as any
  );
  return { state, actions };
}

/** Let the fire-and-forget delete chain settle (macro-task after microtasks). */
const flushDeletes = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('bookmarkService: idempotent bookmark deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockReset (not mockClear) so per-test rejections/implementations on the
    // chrome stubs never leak between tests.
    mockGet.mockReset();
    mockRemove.mockReset();
    mockRemoveTree.mockReset();
  });

  describe('deleteBookmark (task 1.1)', () => {
    it('resolves silently for a missing id (get rejects like real Chrome)', async () => {
      mockGet.mockRejectedValue(CHROME_NOT_FOUND);

      await expect(
        bookmarkService.deleteBookmark('bm-gone')
      ).resolves.toBeUndefined();

      expect(mockGet).toHaveBeenCalledWith('bm-gone');
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('resolves silently when the lookup resolves an empty list', async () => {
      mockGet.mockResolvedValue([]);

      await expect(
        bookmarkService.deleteBookmark('bm-gone')
      ).resolves.toBeUndefined();

      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('still removes an existing bookmark', async () => {
      mockGet.mockResolvedValue([makeNode('bm-1')]);
      mockRemove.mockResolvedValue(undefined);

      await expect(
        bookmarkService.deleteBookmark('bm-1')
      ).resolves.toBeUndefined();

      expect(mockRemove).toHaveBeenCalledWith('bm-1');
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('treats a not-found remove rejection after the pre-check as success', async () => {
      // The bookmark existed at pre-check time but vanished before remove ran.
      mockGet.mockResolvedValue([makeNode('bm-1')]);
      mockRemove.mockRejectedValue(CHROME_NOT_FOUND);

      await expect(
        bookmarkService.deleteBookmark('bm-1')
      ).resolves.toBeUndefined();

      expect(mockRemove).toHaveBeenCalledWith('bm-1');
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('still propagates unrelated remove errors to the toast path', async () => {
      mockGet.mockResolvedValue([makeNode('bm-1')]);
      mockRemove.mockRejectedValue(
        new Error('Cannot remove a folder that is not empty')
      );

      await expect(bookmarkService.deleteBookmark('bm-1')).rejects.toThrow(
        'Cannot remove a folder that is not empty'
      );

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Error deleting bookmark: Cannot remove a folder that is not empty'
      );
    });
  });

  describe('deleteBookmarkTree (task 1.2)', () => {
    it('succeeds silently when the root is already gone', async () => {
      mockGet.mockRejectedValue(CHROME_NOT_FOUND);

      await expect(
        bookmarkService.deleteBookmarkTree('folder-gone')
      ).resolves.toBeUndefined();

      expect(mockGet).toHaveBeenCalledWith('folder-gone');
      expect(mockRemoveTree).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('still removes an existing root', async () => {
      mockGet.mockResolvedValue([makeNode('folder-1')]);
      mockRemoveTree.mockResolvedValue(undefined);

      await expect(
        bookmarkService.deleteBookmarkTree('folder-1')
      ).resolves.toBeUndefined();

      expect(mockRemoveTree).toHaveBeenCalledWith('folder-1');
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it('treats a not-found removeTree rejection after the pre-check as success', async () => {
      mockGet.mockResolvedValue([makeNode('folder-1')]);
      mockRemoveTree.mockRejectedValue(CHROME_NOT_FOUND);

      await expect(
        bookmarkService.deleteBookmarkTree('folder-1')
      ).resolves.toBeUndefined();

      expect(mockRemoveTree).toHaveBeenCalledWith('folder-1');
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });
  });

  describe('link delete path (task 1.3)', () => {
    it('deleteLink with a stale bookmark id shows no error toast', async () => {
      const { state, actions } = makeHarness([
        makeLink({ bookmarkId: 'bm-gone' }),
      ]);
      mockGet.mockRejectedValue(CHROME_NOT_FOUND);

      actions.deleteLink('project-1', 'collection-1', 'link-1');
      await flushDeletes();

      // The stale id was probed, the doomed remove never ran, and nothing
      // surfaced to the user — but the link itself is gone from the store.
      expect(mockGet).toHaveBeenCalledWith('bm-gone');
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
      expect(state.projects[0].collections[0].links).toHaveLength(0);
    });

    it('deleteLink with a live bookmark still removes it, without errors', async () => {
      const { state, actions } = makeHarness([
        makeLink({ bookmarkId: 'bm-1' }),
      ]);
      mockGet.mockResolvedValue([makeNode('bm-1')]);
      mockRemove.mockResolvedValue(undefined);

      actions.deleteLink('project-1', 'collection-1', 'link-1');
      await flushDeletes();

      expect(mockRemove).toHaveBeenCalledWith('bm-1');
      expect(mockShowErrorToast).not.toHaveBeenCalled();
      expect(state.projects[0].collections[0].links).toHaveLength(0);
    });
  });

  describe('linkSync orphan cleanup (task 1.3)', () => {
    it('cleans up a link whose bookmark vanished without a toast', async () => {
      const { state, actions } = makeHarness([
        makeLink({ bookmarkId: 'bm-gone' }),
      ]);
      const deleteLinkSpy = jest.fn(actions.deleteLink);
      (useAppStore.getState as jest.Mock).mockReturnValue({
        ...state,
        deleteLink: deleteLinkSpy,
      });
      mockGet.mockRejectedValue(CHROME_NOT_FOUND);

      // bookmarkLinks is empty: the mirror bookmark for link-1 is gone, so
      // sync's orphan cleanup deletes the link.
      await new LinkSync().syncLinks('project-1', 'collection-1', []);
      await flushDeletes();

      expect(deleteLinkSpy).toHaveBeenCalledWith(
        'project-1',
        'collection-1',
        'link-1'
      );
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
      expect(state.projects[0].collections[0].links).toHaveLength(0);
    });
  });
});
