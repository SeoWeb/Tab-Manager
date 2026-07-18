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
  mockChrome,
  mockUseAppStore,
  createMockStore,
  resetServiceState,
  resetBookmarkMocks,
} from './shared';

describe('BookmarkSyncService: initialize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    resetBookmarkMocks();
    const mockStore = createMockStore();
    mockUseAppStore.mockReturnValue(mockStore);
    mockUseAppStore.getState = jest.fn().mockReturnValue(mockStore);
  });

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
