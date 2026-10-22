// Task 5.3: performPartialSync must be a real trailing-edge debounce (1 s) so
// N rapid bookmark events collapse into exactly ONE sync.
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
import { PARTIAL_SYNC_DEBOUNCE_MS } from '../../bookmarkSyncService';

describe('BookmarkSyncService: performPartialSync debounce', () => {
  let fullSyncSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    fullSyncSpy = jest
      .spyOn(bookmarkSyncService, 'performFullSync')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Cancel any pending debounced sync left by a test.
    bookmarkSyncService.destroy();
    jest.useRealTimers();
  });

  it('collapses 20 rapid events into exactly one trailing sync', async () => {
    for (let i = 0; i < 20; i++) {
      await bookmarkSyncService.performPartialSync(`folder-${i}`);
    }

    // Nothing runs before the window closes (no leading-edge call).
    expect(fullSyncSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PARTIAL_SYNC_DEBOUNCE_MS - 1);
    expect(fullSyncSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fullSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('re-arms the window on each event inside it (trailing edge)', async () => {
    await bookmarkSyncService.performPartialSync('folder-a');
    jest.advanceTimersByTime(600);

    // A second event 600 ms in resets the timer: the original run must not
    // fire at t=1000.
    await bookmarkSyncService.performPartialSync('folder-b');
    jest.advanceTimersByTime(600);
    expect(fullSyncSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(fullSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('runs the sync once after the LAST event settles', async () => {
    // 19 events, then a 21-event burst 800 ms in — still exactly one run.
    for (let i = 0; i < 20; i++) {
      await bookmarkSyncService.performPartialSync(`folder-${i}`);
    }
    jest.advanceTimersByTime(800);
    for (let i = 0; i < 20; i++) {
      await bookmarkSyncService.performPartialSync(`folder-burst-${i}`);
    }

    jest.advanceTimersByTime(PARTIAL_SYNC_DEBOUNCE_MS);
    expect(fullSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('destroy() cancels a pending debounced sync', async () => {
    await bookmarkSyncService.performPartialSync('folder-a');

    bookmarkSyncService.destroy();
    jest.advanceTimersByTime(PARTIAL_SYNC_DEBOUNCE_MS * 5);

    expect(fullSyncSpy).not.toHaveBeenCalled();
  });
});
