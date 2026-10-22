// Task 5.6: destroy() must actually remove the listeners registered in
// initialize() (stable bound references), so a teardown + re-create cycle
// handles each bookmark event exactly once.
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

import { BookmarkSyncService } from '../../bookmarkSyncService';
import { useAppStore } from '@/stores/appStore';

/** Minimal chrome.events.Event stand-in with a real listener registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createFakeEvent(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: jest.fn((fn: (...args: unknown[]) => void) => {
      listeners.add(fn);
    }),
    removeListener: jest.fn((fn: (...args: unknown[]) => void) => {
      listeners.delete(fn);
    }),
    dispatch: (...args: unknown[]) => {
      for (const fn of [...listeners]) fn(...args);
    },
    count: () => listeners.size,
    reset: () => {
      listeners.clear();
    },
  };
}

const mockStore = {
  tabManagerRootFolderId: 'root-1',
  projects: [],
};
(useAppStore as jest.MockedFunction<typeof useAppStore>).getState = jest
  .fn()
  .mockReturnValue(mockStore);

const createdEvent = createFakeEvent();
const removedEvent = createFakeEvent();
const changedEvent = createFakeEvent();
const movedEvent = createFakeEvent();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).chrome = {
  bookmarks: {
    onCreated: createdEvent,
    onRemoved: removedEvent,
    onChanged: changedEvent,
    onMoved: movedEvent,
  },
};

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BookmarkSyncService: listener lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jest.clearAllMocks only resets call records — clear the listener
    // registries so tests start from a bare Chrome.
    [createdEvent, removedEvent, changedEvent, movedEvent].forEach((event) => {
      event.reset();
    });
  });

  it('registers exactly one listener per event on initialize', async () => {
    const service = new BookmarkSyncService();
    await service.initialize();

    expect(createdEvent.count()).toBe(1);
    expect(removedEvent.count()).toBe(1);
    expect(changedEvent.count()).toBe(1);
    expect(movedEvent.count()).toBe(1);
  });

  it('destroy() removes the exact references addListener received', async () => {
    const service = new BookmarkSyncService();
    await service.initialize();

    const addedRef = createdEvent.addListener.mock.calls[0][0];
    service.destroy();

    expect(createdEvent.removeListener).toHaveBeenCalledWith(addedRef);
    expect(createdEvent.count()).toBe(0);
    expect(removedEvent.count()).toBe(0);
    expect(changedEvent.count()).toBe(0);
    expect(movedEvent.count()).toBe(0);
  });

  it('handles events exactly once after teardown + re-create', async () => {
    const serviceA = new BookmarkSyncService();
    await serviceA.initialize();
    serviceA.destroy();

    const serviceB = new BookmarkSyncService();
    await serviceB.initialize();

    // Old listeners must be gone: only serviceB's listener remains.
    expect(createdEvent.count()).toBe(1);

    const partialSyncSpy = jest
      .spyOn(serviceB, 'performPartialSync')
      .mockResolvedValue(undefined);

    createdEvent.dispatch('bm-1', {
      id: 'bm-1',
      parentId: 'root-1',
      title: 'New Bookmark',
      url: 'https://example.com',
    } as chrome.bookmarks.BookmarkTreeNode);
    await flushAsync();

    // The surviving handler ran exactly once (the destroyed serviceA's
    // listener did not also fire).
    expect(partialSyncSpy).toHaveBeenCalledTimes(1);
    expect(partialSyncSpy).toHaveBeenCalledWith('root-1');
  });

  it('initialize() after destroy() re-registers cleanly (no duplicates)', async () => {
    const service = new BookmarkSyncService();
    await service.initialize();
    service.destroy();
    await service.initialize();
    await service.initialize(); // second call is a no-op

    expect(createdEvent.count()).toBe(1);
  });
});
