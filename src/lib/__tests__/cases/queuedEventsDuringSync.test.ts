// Task 5.1 integration: a bookmark event arriving while a sync is in progress
// is queued (coalesced per bookmark id) and applied after the sync completes —
// not dropped.
//
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
  preloadFavicon: jest.fn().mockResolvedValue(''),
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

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BookmarkSyncService: queued events during sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    resetBookmarkMocks();
    const mockStore = createMockStore();
    mockUseAppStore.mockReturnValue(mockStore);
    mockUseAppStore.getState = jest.fn().mockReturnValue(mockStore);
  });

  it('queues an event arriving mid-sync and applies it after completion', async () => {
    await bookmarkSyncService.initialize();

    // Hold the root getChildren call open so the full sync stays in progress.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveRoot!: (folders: any[]) => void;
    mockBookmarkService.getChildren.mockImplementation((folderId: string) => {
      if (folderId === 'root-folder-id') {
        return new Promise((resolve) => {
          resolveRoot = resolve;
        });
      }
      return Promise.resolve([]);
    });
    // Terminate the managed-folder walk at the root in one step.
    mockBookmarkService.getBookmarkNode.mockResolvedValue({
      id: 'root-folder-id',
      title: 'Root',
      parentId: 'root-folder-id',
    } as chrome.bookmarks.BookmarkTreeNode);

    const partialSyncSpy = jest
      .spyOn(bookmarkSyncService, 'performPartialSync')
      .mockResolvedValue(undefined);

    const syncPromise = bookmarkSyncService.performFullSync();
    await flushAsync();
    expect(bookmarkSyncService.syncInProgress).toBe(true);

    const node = {
      id: 'bm-1',
      parentId: 'collection-folder-id',
      title: 'New Bookmark',
      url: 'https://example.com',
    } as chrome.bookmarks.BookmarkTreeNode;
    const createdHandler =
      mockChrome.bookmarks.onCreated.addListener.mock.calls[0][0];

    // A burst of three events for the SAME bookmark id arrives mid-sync.
    await createdHandler('bm-1', node);
    await createdHandler('bm-1', node);
    await createdHandler('bm-1', node);

    // Nothing was dropped and nothing was applied while the sync ran — and
    // the burst coalesced into a single queued entry.
    expect(partialSyncSpy).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (bookmarkSyncService as any).syncHandlers;
    expect(handlers.queuedEventCount).toBe(1);

    // Sync completes → the queued event is drained and applied.
    resolveRoot([]);
    await syncPromise;
    await flushAsync();

    expect(handlers.queuedEventCount).toBe(0);
    expect(partialSyncSpy).toHaveBeenCalledTimes(1);
    expect(partialSyncSpy).toHaveBeenCalledWith('collection-folder-id');

    partialSyncSpy.mockRestore();
  });

  it('processes an event immediately when no sync is running', async () => {
    await bookmarkSyncService.initialize();

    mockBookmarkService.getBookmarkNode.mockResolvedValue({
      id: 'root-folder-id',
      title: 'Root',
      parentId: 'root-folder-id',
    } as chrome.bookmarks.BookmarkTreeNode);

    const partialSyncSpy = jest
      .spyOn(bookmarkSyncService, 'performPartialSync')
      .mockResolvedValue(undefined);

    const createdHandler =
      mockChrome.bookmarks.onCreated.addListener.mock.calls[0][0];
    await createdHandler('bm-1', {
      id: 'bm-1',
      parentId: 'collection-folder-id',
    } as chrome.bookmarks.BookmarkTreeNode);

    // No sync in progress → straight to a (debounced) partial sync, no queue.
    expect(partialSyncSpy).toHaveBeenCalledWith('collection-folder-id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bookmarkSyncService as any).syncHandlers.queuedEventCount).toBe(0);

    partialSyncSpy.mockRestore();
  });
});
