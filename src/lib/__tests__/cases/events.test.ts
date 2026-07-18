// Mocks must be declared at the top of the test file so Jest registers them.
jest.mock('../../bookmarkService');
jest.mock('@/stores/appStore', () => ({
  useAppStore: jest.fn(),
}));
jest.mock('../../utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  getInitials: () => '',
  isValidUrl: () => true,
  getFullUrl: (url: string) => url,
  getFaviconUrl: jest.fn(),
  preloadFavicon: jest
    .fn()
    .mockResolvedValue('https://www.google.com/s2/favicons?domain=newlink.com'),
}));

import { bookmarkSyncService } from '../../bookmarkSyncService';
import {
  mockBookmarkService,
  mockChrome,
  mockUseAppStore,
  createMockStore,
  resetServiceState,
  resetBookmarkMocks,
} from './shared';

describe('BookmarkSyncService: events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    resetBookmarkMocks();
    const mockStore = createMockStore();
    mockUseAppStore.mockReturnValue(mockStore);
    mockUseAppStore.getState = jest.fn().mockReturnValue(mockStore);
  });

  describe('handleBookmarkCreated', () => {
    it('should trigger sync when bookmark is created in managed folder', async () => {
      // Make the managed-folder walk terminate at the root in one step:
      // collection-folder-id -> parent (root-folder-id) -> matches root.
      mockBookmarkService.getBookmarkNode.mockResolvedValue({
        id: 'root-folder-id',
        title: 'TabSpace Projects',
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
