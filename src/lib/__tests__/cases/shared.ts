// Shared setup for BookmarkSyncService test cases.
// Each `cases/*.test.ts` must declare the `jest.mock(...)` calls at its own top
// level (Jest only registers mocks from test files), then import the helpers
// below to get the mocked services, store, and Chrome API stubs.

import { bookmarkSyncService } from '../../bookmarkSyncService';
import { bookmarkService } from '../../bookmarkService';
import { useAppStore } from '@/stores/appStore';

export const mockBookmarkService = bookmarkService as jest.Mocked<
  typeof bookmarkService
>;
export const mockUseAppStore = useAppStore as jest.MockedFunction<
  typeof useAppStore
>;

// Mock Chrome APIs
export const mockChrome = {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockStore(): any {
  return {
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
}

export function resetServiceState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bookmarkSyncService as any).isInitialized = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bookmarkSyncService as any).syncInProgress = false;
}

export function resetBookmarkMocks() {
  mockBookmarkService.getChildren.mockReset();
  mockBookmarkService.getBookmarkNode.mockReset();
}
