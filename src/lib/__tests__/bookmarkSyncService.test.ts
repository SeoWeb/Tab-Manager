// src/lib/__tests__/bookmarkSyncService.test.ts

import { bookmarkSyncService } from '../bookmarkSyncService';
import { bookmarkService } from '../bookmarkService';
import { useAppStore } from '@/stores/appStore';

// Mock the dependencies
jest.mock('../bookmarkService');
jest.mock('@/stores/appStore');

const mockBookmarkService = bookmarkService as jest.Mocked<typeof bookmarkService>;
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

// @ts-ignore
global.chrome = mockChrome;

describe('BookmarkSyncService', () => {
  let mockStore: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
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
      expect(mockChrome.bookmarks.onCreated.addListener).toHaveBeenCalledTimes(1);
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

      expect(mockBookmarkService.getChildren).toHaveBeenCalledWith('root-folder-id');
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

      // Should only call getChildren once
      expect(mockBookmarkService.getChildren).toHaveBeenCalledTimes(1);
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

      expect(mockStore.addProject).toHaveBeenCalledWith({
        name: 'New Project',
        description: 'Imported from bookmarks',
        color: '#4285F4',
        icon: 'N',
      });
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

      expect(mockStore.addCollection).toHaveBeenCalledWith('project-1', {
        name: 'New Collection',
        description: 'Imported from bookmarks',
        color: undefined,
      });
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

      expect(mockStore.addLink).toHaveBeenCalledWith('project-1', 'collection-1', {
        title: 'New Link',
        url: 'https://newlink.com',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=newlink.com',
        tags: [],
        notes: 'Imported from bookmarks',
      });
    });
  });

  describe('handleBookmarkCreated', () => {
    it('should trigger sync when bookmark is created in managed folder', async () => {
      // Mock isWithinManagedFolders to return true
      mockBookmarkService.getBookmarkNode.mockResolvedValue({
        id: 'root-folder-id',
        title: 'Tab Manager Projects',
        parentId: '2',
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

      // Simulate bookmark created event
      const createdHandler = mockChrome.bookmarks.onCreated.addListener.mock.calls[0][0];
      
      await bookmarkSyncService.initialize();
      await createdHandler('new-bookmark-id', bookmark);

      // Should trigger a sync (with debounce)
      expect(mockBookmarkService.getBookmarkNode).toHaveBeenCalled();
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