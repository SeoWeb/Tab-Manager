// Task 5.2: bookmarkStorage must manage the echo-suppression flag with
// try/finally around every extension-initiated bookmark write — never with a
// timer-based reset — and a mid-write failure must restore the flag.
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

import { bookmarkStorage } from '../../bookmarkStorage';
import { bookmarkSyncService } from '../../bookmarkSyncService';
import { bookmarkService } from '../../bookmarkService';

const mockBookmarkService = bookmarkService as jest.Mocked<
  typeof bookmarkService
>;

const folderNode = {
  id: 'new-folder-id',
  title: 'New Folder',
  parentId: 'root-folder-id',
  index: 0,
  dateAdded: Date.now(),
  dateGroupModified: Date.now(),
  unmodifiable: undefined,
  children: undefined,
  url: undefined,
} as chrome.bookmarks.BookmarkTreeNode;

describe('bookmarkStorage: echo suppression (try/finally)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookmarkSyncService.suppressEchoes = false;
    bookmarkSyncService.syncInProgress = false;
  });

  it('suppresses echoes for the exact duration of a create write', async () => {
    let flagDuringWrite: boolean | undefined;
    mockBookmarkService.createBookmarkFolder.mockImplementation(async () => {
      flagDuringWrite = bookmarkSyncService.suppressEchoes;
      return folderNode;
    });

    const result = await bookmarkStorage.createProject('P', 'root-folder-id');

    expect(result).toBe(folderNode);
    expect(flagDuringWrite).toBe(true);
    // Restored immediately after the write resolves — not 100 ms later on a
    // timer.
    expect(bookmarkSyncService.suppressEchoes).toBe(false);
  });

  it('restores the flag when the write throws mid-operation', async () => {
    mockBookmarkService.deleteBookmarkTree.mockRejectedValue(
      new Error('bookmark tree delete failed')
    );

    await expect(bookmarkStorage.deleteProject('folder-1')).rejects.toThrow(
      'bookmark tree delete failed'
    );

    // The finally block ran: sync is NOT permanently muted.
    expect(bookmarkSyncService.suppressEchoes).toBe(false);
  });

  it('restores the previous flag value rather than resetting it', async () => {
    // Simulate a nested/suppressing context that had the flag up.
    bookmarkSyncService.suppressEchoes = true;
    mockBookmarkService.createBookmarkFolder.mockRejectedValue(
      new Error('create failed')
    );

    await expect(
      bookmarkStorage.createCollection('C', 'folder-1')
    ).rejects.toThrow('create failed');

    expect(bookmarkSyncService.suppressEchoes).toBe(true);
    bookmarkSyncService.suppressEchoes = false;
  });

  it('wraps every extension-initiated bookmark write', async () => {
    mockBookmarkService.createBookmarkFolder.mockResolvedValue(folderNode);
    mockBookmarkService.createBookmark.mockResolvedValue(folderNode);
    mockBookmarkService.updateBookmark.mockResolvedValue(folderNode);
    mockBookmarkService.deleteBookmarkTree.mockResolvedValue(undefined);
    mockBookmarkService.deleteBookmark.mockResolvedValue(undefined);
    mockBookmarkService.moveBookmark.mockResolvedValue(folderNode);

    // Each storage write funnels into one bookmarkService method; instrument
    // that method to record the flag value while the write is in flight.
    const cases: Array<{
      serviceMethod: keyof typeof mockBookmarkService;
      write: () => Promise<unknown>;
    }> = [
      {
        serviceMethod: 'createBookmarkFolder',
        write: () => bookmarkStorage.createProject('P', 'root'),
      },
      {
        serviceMethod: 'updateBookmark',
        write: () => bookmarkStorage.updateProject('f1', 'New Name'),
      },
      {
        serviceMethod: 'deleteBookmarkTree',
        write: () => bookmarkStorage.deleteProject('f1'),
      },
      {
        serviceMethod: 'createBookmarkFolder',
        write: () => bookmarkStorage.createCollection('C', 'f1'),
      },
      {
        serviceMethod: 'updateBookmark',
        write: () => bookmarkStorage.updateCollection('f1', 'New Name'),
      },
      {
        serviceMethod: 'deleteBookmarkTree',
        write: () => bookmarkStorage.deleteCollection('f1'),
      },
      {
        serviceMethod: 'createBookmark',
        write: () => bookmarkStorage.createLink('L', 'https://x', 'f1'),
      },
      {
        serviceMethod: 'updateBookmark',
        write: () => bookmarkStorage.updateLink('b1', { title: 'New' }),
      },
      {
        serviceMethod: 'deleteBookmark',
        write: () => bookmarkStorage.deleteLink('b1'),
      },
      {
        serviceMethod: 'moveBookmark',
        write: () => bookmarkStorage.moveBookmark('b1', { parentId: 'f2' }),
      },
    ];

    for (const { serviceMethod, write } of cases) {
      let flagDuringWrite: boolean | undefined;
      const mock = mockBookmarkService[serviceMethod] as jest.Mock;
      mock.mockImplementationOnce(async () => {
        flagDuringWrite = bookmarkSyncService.suppressEchoes;
        const returnsNode =
          serviceMethod === 'createBookmarkFolder' ||
          serviceMethod === 'createBookmark' ||
          serviceMethod === 'moveBookmark';
        return returnsNode ? { ...folderNode } : undefined;
      });

      await write();

      expect(flagDuringWrite).toBe(true);
      expect(bookmarkSyncService.suppressEchoes).toBe(false);
    }
  });
});
