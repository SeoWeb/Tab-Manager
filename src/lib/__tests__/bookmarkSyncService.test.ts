// src/lib/__tests__/bookmarkSyncService.test.ts

import { bookmarkSyncService } from '../bookmarkSyncService';
import { bookmarkService } from '../bookmarkService';
import { useAppStore } from '@/stores/appStore';

// Mock the dependencies
jest.mock('../bookmarkService');
// Factory mock so the real store is never loaded. The real `appStore` imports
// `nanoid` (ESM-only) via `mockData`, which Jest's CJS transform cannot parse.
jest.mock('@/stores/appStore', () => ({
  useAppStore: jest.fn(),
}));
// Stub favicon preloading (network/cache) so link creation is deterministic.
jest.mock('../utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  getInitials: () => '',
  isValidUrl: () => true,
  getFullUrl: (url: string) => url,
  getFaviconUrl: jest.fn(),
  preloadFavicon: jest
    .fn()
    .mockResolvedValue('https://www.google.com/s2/favicons?domain=newlink.com'),
}));

const mockBookmarkService = bookmarkService as jest.Mocked<
  typeof bookmarkService
>;
const mockUseAppStore = useAppStore as jest.MockedFunction<typeof useAppStore>;

// Mock Chrome APIs
const mockChrome = {
  bookmarks: {
    onCreated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onMoved: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
};

// @ts-expect-error - Mocking global chrome for testing
global.chrome = mockChrome;

describe('BookmarkSyncService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // The service is a module singleton whose `isInitialized` / `syncInProgress`
    // flags persist across tests; clearAllMocks only clears call history, so
    // reset the instance state explicitly to keep each test isolated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bookmarkSyncService as any).isInitialized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bookmarkSyncService as any).syncInProgress = false;

    // clearAllMocks also does not clear the one-shot `mockResolvedValueOnce`
    // queue, so leftover return values would leak between tests (e.g. an
    // unconsumed value from one sync shifting the next test's responses). Reset
    // the bookmark-service mocks that use one-shot queues; each test sets up the
    // mock it needs.
    mockBookmarkService.getChildren.mockReset();
    mockBookmarkService.getBookmarkNode.mockReset();

    mockStore = {
      tabManagerRootFolderId: 'root-folder-id',
      projects: [
        {
          id: 'project-1',
          name: 'Test Project',
          bookmarkFolderId: 'project-folder-id',
          collections: [
            {
              id: 'collection-1',
              name: 'Test Collection',
              bookmarkFolderId: 'collection-folder-id',
              links: [
                {
                  id: 'link-1',
                  title: 'Test Link',
                  url: 'https://example.com',
                  bookmarkId: 'bookmark-id',
                },
              ],
            },
          ],
        },
      ],
      addProject: jest.fn(),
      updateProject: jest.fn(),
      deleteProject: jest.fn(),
      addCollection: jest.fn(),
      updateCollection: jest.fn(),
      deleteCollection: jest.fn(),
      addLink: jest.fn(),
      updateLink: jest.fn(),
      deleteLink: jest.fn(),
    };

    mockUseAppStore.mockReturnValue(mockStore);
    mockUseAppStore.getState = jest.fn().mockReturnValue(mockStore);
  });

  describe('initialize', () => {
    it('should set up Chrome bookmark event listeners', async () => {
      await bookmarkSyncService.initialize();

      expect(mockChrome.bookmarks.onCreated.addListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onRemoved.addListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onChanged.addListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onMoved.addListener).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await bookmarkSyncService.initialize();
      await bookmarkSyncService.initialize();

      // Should only be called once
      expect(mockChrome.bookmarks.onCreated.addListener).toHaveBeenCalledTimes(
        1
      );
    });
  });

  describe('performFullSync', () => {
    beforeEach(() => {
      mockBookmarkService.getChildren.mockResolvedValue([
        {
          id: 'project-folder-id',
          title: 'Test Project',
          parentId: 'root-folder-id',
          index: 0,
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
          unmodifiable: undefined,
          children: undefined,
          url: undefined,
        } as chrome.bookmarks.BookmarkTreeNode,
      ]);
    });

    it('should sync projects from bookmark folders', async () => {
      await bookmarkSyncService.performFullSync();

      expect(mockBookmarkService.getChildren).toHaveBeenCalledWith(
        'root-folder-id'
      );
    });

    it('should handle missing root folder ID', async () => {
      mockStore.tabManagerRootFolderId = null;

      await bookmarkSyncService.performFullSync();

      expect(mockBookmarkService.getChildren).not.toHaveBeenCalled();
    });

    it('should not run concurrent syncs', async () => {
      const promise1 = bookmarkSyncService.performFullSync();
      const promise2 = bookmarkSyncService.performFullSync();

      await Promise.all([promise1, promise2]);

      // A single sync starts with exactly one root-folder getChildren call; if
      // the second concurrent sync had also run, the root call would repeat.
      // (Each sync also makes nested project/collection getChildren calls, so a
      // raw call count would not prove the second sync was skipped.)
      const rootCalls = mockBookmarkService.getChildren.mock.calls.filter(
        ([id]) => id === 'root-folder-id'
      );
      expect(rootCalls).toHaveLength(1);
    });
  });

  describe('createProjectFromBookmark', () => {
    it('should create a new project from bookmark folder', async () => {
      const bookmarkFolder = {
        id: 'new-project-folder-id',
        title: 'New Project',
        parentId: 'root-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      mockBookmarkService.getChildren.mockResolvedValue([bookmarkFolder]);

      // Mock the newly created project
      mockStore.projects = [
        ...mockStore.projects,
        {
          id: 'new-project-id',
          name: 'New Project',
          bookmarkFolderId: null,
          collections: [],
        },
      ];

      await bookmarkSyncService.performFullSync();

      expect(mockStore.addProject).toHaveBeenCalledWith(
        {
          name: 'New Project',
          description: 'Imported from bookmarks',
          color: '#4285F4',
          icon: 'N',
        },
        { skipBookmarkCreation: true } // importing FROM bookmarks
      );
    });
  });

  describe('syncProject', () => {
    it('should update project name when changed in bookmarks', async () => {
      const bookmarkFolder = {
        id: 'project-folder-id',
        title: 'Updated Project Name',
        parentId: 'root-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      mockBookmarkService.getChildren
        .mockResolvedValueOnce([bookmarkFolder]) // Root children
        .mockResolvedValueOnce([]); // Project children

      await bookmarkSyncService.performFullSync();

      expect(mockStore.updateProject).toHaveBeenCalledWith(
        'project-1',
        { name: 'Updated Project Name' },
        true
      );
    });
  });

  describe('createCollectionFromBookmark', () => {
    it('should create a new collection from bookmark folder', async () => {
      const projectFolder = {
        id: 'project-folder-id',
        title: 'Test Project',
        parentId: 'root-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      const collectionFolder = {
        id: 'new-collection-folder-id',
        title: 'New Collection',
        parentId: 'project-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      mockBookmarkService.getChildren
        .mockResolvedValueOnce([projectFolder]) // Root children
        .mockResolvedValueOnce([collectionFolder]) // Project children
        .mockResolvedValueOnce([]); // Collection children

      await bookmarkSyncService.performFullSync();

      expect(mockStore.addCollection).toHaveBeenCalledWith(
        'project-1',
        {
          name: 'New Collection',
          description: 'Imported from bookmarks',
          color: undefined,
        },
        true // skipBookmarkCreation: importing FROM bookmarks
      );
    });
  });

  describe('createLinkFromBookmark', () => {
    it('should create a new link from bookmark', async () => {
      const projectFolder = {
        id: 'project-folder-id',
        title: 'Test Project',
        parentId: 'root-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      const collectionFolder = {
        id: 'collection-folder-id',
        title: 'Test Collection',
        parentId: 'project-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      const linkBookmark = {
        id: 'new-bookmark-id',
        title: 'New Link',
        url: 'https://newlink.com',
        parentId: 'collection-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
      } as chrome.bookmarks.BookmarkTreeNode;

      mockBookmarkService.getChildren
        .mockResolvedValueOnce([projectFolder]) // Root children
        .mockResolvedValueOnce([collectionFolder]) // Project children
        .mockResolvedValueOnce([linkBookmark]); // Collection children

      await bookmarkSyncService.performFullSync();

      expect(mockStore.addLink).toHaveBeenCalledWith(
        'project-1',
        'collection-1',
        {
          title: 'New Link',
          url: 'https://newlink.com',
          favIconUrl: 'https://www.google.com/s2/favicons?domain=newlink.com',
          tags: [],
          notes: 'Imported from bookmarks',
        },
        true // skipBookmarkCreation: importing FROM bookmarks
      );
    });
  });

  describe('handleBookmarkCreated', () => {
    it('should trigger sync when bookmark is created in managed folder', async () => {
      // Make the managed-folder walk terminate at the root in one step:
      // collection-folder-id -> parent (root-folder-id) -> matches root.
      mockBookmarkService.getBookmarkNode.mockResolvedValue({
        id: 'root-folder-id',
        title: 'Tab Manager Projects',
        parentId: 'root-folder-id',
        index: 0,
        dateAdded: Date.now(),
        dateGroupModified: Date.now(),
        unmodifiable: undefined,
        children: undefined,
        url: undefined,
      } as chrome.bookmarks.BookmarkTreeNode);

      const bookmark = {
        id: 'new-bookmark-id',
        title: 'New Bookmark',
        url: 'https://example.com',
        parentId: 'collection-folder-id',
      };

      // Avoid the real debounced performFullSync firing on a timer; we only care
      // that a sync is triggered.
      const partialSyncSpy = jest
        .spyOn(bookmarkSyncService, 'performPartialSync')
        .mockResolvedValue(undefined);

      // Listeners are registered during initialize(), so capture the handler
      // after initializing (not before).
      await bookmarkSyncService.initialize();
      const createdHandler =
        mockChrome.bookmarks.onCreated.addListener.mock.calls[0][0];

      await createdHandler(
        'new-bookmark-id',
        bookmark as chrome.bookmarks.BookmarkTreeNode
      );

      // Should resolve the bookmark's lineage and trigger a partial sync.
      expect(mockBookmarkService.getBookmarkNode).toHaveBeenCalled();
      expect(partialSyncSpy).toHaveBeenCalledWith('collection-folder-id');
      partialSyncSpy.mockRestore();
    });
  });

  describe('destroy', () => {
    it('should remove event listeners', () => {
      bookmarkSyncService.destroy();

      expect(mockChrome.bookmarks.onCreated.removeListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onRemoved.removeListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onChanged.removeListener).toHaveBeenCalled();
      expect(mockChrome.bookmarks.onMoved.removeListener).toHaveBeenCalled();
    });
  });
});
