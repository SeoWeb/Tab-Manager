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
  mockUseAppStore,
  createMockStore,
  resetServiceState,
  resetBookmarkMocks,
} from './shared';

describe('BookmarkSyncService: performFullSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    resetBookmarkMocks();
    const mockStore = createMockStore();
    mockUseAppStore.mockReturnValue(mockStore);
    mockUseAppStore.getState = jest.fn().mockReturnValue(mockStore);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockUseAppStore.getState() as any).tabManagerRootFolderId = null;

      await bookmarkSyncService.performFullSync();

      expect(mockBookmarkService.getChildren).not.toHaveBeenCalled();
    });

    it('should not run concurrent syncs', async () => {
      const promise1 = bookmarkSyncService.performFullSync();
      const promise2 = bookmarkSyncService.performFullSync();

      await Promise.all([promise1, promise2]);

      // A single sync starts with exactly one root-folder getChildren call; if
      // the second concurrent sync had also run, the root call would repeat.
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStore = mockUseAppStore.getState() as any;
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStore = mockUseAppStore.getState() as any;
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStore = mockUseAppStore.getState() as any;
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStore = mockUseAppStore.getState() as any;
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
});
