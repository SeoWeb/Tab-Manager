// Task 4.5 (cleanup-and-regression-tests): the bookmark-mirror queue is the
// sequencing primitive behind `moveLink`. These tests pin its guarantees:
// commit-on-success-only, compensation of a half-completed move, bounded
// retry convergence, per-link serialization with late binding, and
// independence of different links.

jest.mock('@/lib/bookmarkStorage', () => ({
  bookmarkStorage: {
    createLink: jest.fn(),
    deleteLink: jest.fn(),
  },
}));

import { bookmarkStorage } from '@/lib/bookmarkStorage';
import {
  queueLinkBookmarkMove,
  resetLinkBookmarkMirrorForTests,
  type LinkBookmarkMirrorRequest,
  type LinkMirrorSnapshot,
} from '@/lib/linkBookmarkMirror';

const mockCreateLink = bookmarkStorage.createLink as jest.Mock;
const mockDeleteLink = bookmarkStorage.deleteLink as jest.Mock;

function makeNode(id: string): chrome.bookmarks.BookmarkTreeNode {
  return {
    id,
    title: 'Example',
    url: 'https://example.com',
  } as chrome.bookmarks.BookmarkTreeNode;
}

const SNAPSHOT: LinkMirrorSnapshot = {
  oldBookmarkId: 'b-old',
  title: 'Example',
  url: 'https://example.com',
};

function makeRequest(overrides: Partial<LinkBookmarkMirrorRequest> = {}) {
  const events: string[] = [];
  const request: LinkBookmarkMirrorRequest = {
    linkId: 'link-1',
    targetFolderId: 'folder-target',
    resolveMirror: () => {
      events.push('resolve');
      return { ...SNAPSHOT };
    },
    commitBookmarkId: (id) => {
      events.push(`commit:${id}`);
    },
    // Keep retries on the microtask queue so tests need no fake timers.
    retryDelayMs: 0,
    ...overrides,
  };
  return { request, events };
}

describe('linkBookmarkMirror', () => {
  beforeEach(() => {
    // reset (not clear) so mock implementations never leak between cases.
    jest.resetAllMocks();
    resetLinkBookmarkMirrorForTests();
    mockDeleteLink.mockResolvedValue(undefined);
  });

  it('creates in the target folder, deletes the old bookmark, then commits the new id — in that order', async () => {
    const { request, events } = makeRequest();
    mockCreateLink.mockResolvedValue(makeNode('b-new'));

    await queueLinkBookmarkMove(request);

    expect(mockCreateLink).toHaveBeenCalledWith(
      'Example',
      'https://example.com',
      'folder-target'
    );
    expect(mockDeleteLink).toHaveBeenCalledWith('b-old');
    expect(events).toEqual(['resolve', 'commit:b-new']);
  });

  it('does not delete or commit when the create fails — the old mapping stays authoritative', async () => {
    const { request, events } = makeRequest();
    mockCreateLink.mockRejectedValue(new Error('chrome down'));
    const errorSpy = jest.spyOn(console, 'error');

    await queueLinkBookmarkMove(request);

    expect(mockDeleteLink).not.toHaveBeenCalled();
    expect(events).toEqual(['resolve', 'resolve']); // retried once, never committed
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping the existing bookmarkId'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('compensates a failed delete by removing the fresh bookmark and never commits', async () => {
    const { request, events } = makeRequest();
    mockCreateLink.mockResolvedValue(makeNode('b-new'));
    mockDeleteLink.mockImplementation((id: string) =>
      id === 'b-old'
        ? Promise.reject(new Error('delete refused'))
        : Promise.resolve()
    );
    const errorSpy = jest.spyOn(console, 'error');

    await queueLinkBookmarkMove(request);

    // The half-completed move was rolled back: on every attempt the freshly
    // created bookmark was deleted again, so no duplicate is orphaned in the
    // target folder and the pre-op mapping survives.
    expect(mockDeleteLink).toHaveBeenCalledWith('b-new');
    expect(mockDeleteLink).toHaveBeenCalledTimes(4); // 2 failed deletes + 2 compensations
    expect(events).toEqual(['resolve', 'resolve']); // no commit on either attempt
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping the existing bookmarkId'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('retries a transient failure and converges on the second attempt', async () => {
    const { request, events } = makeRequest();
    mockCreateLink
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(makeNode('b-new-2'));

    await queueLinkBookmarkMove(request);

    expect(mockCreateLink).toHaveBeenCalledTimes(2);
    expect(mockDeleteLink).toHaveBeenCalledTimes(1);
    expect(mockDeleteLink).toHaveBeenCalledWith('b-old');
    expect(events).toEqual(['resolve', 'resolve', 'commit:b-new-2']);
  });

  it('skips the op without writing anything when the mirror mapping is gone', async () => {
    const { request, events } = makeRequest({
      resolveMirror: () => null,
    });

    await queueLinkBookmarkMove(request);

    expect(mockCreateLink).not.toHaveBeenCalled();
    expect(mockDeleteLink).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('serializes ops for the same link and late-binds the current bookmark id', async () => {
    const { request: first, events: firstEvents } = makeRequest();
    // The second op is queued while the first is still pending; it must act on
    // the id the first op committed, not the one captured at submission time.
    const { request: second, events: secondEvents } = makeRequest({
      resolveMirror: () => {
        secondEvents.push('resolve');
        return { ...SNAPSHOT, oldBookmarkId: 'b-1' };
      },
    });

    let resolveFirstCreate:
      | ((node: chrome.bookmarks.BookmarkTreeNode) => void)
      | undefined;
    mockCreateLink
      .mockResolvedValueOnce(
        new Promise((resolve) => {
          resolveFirstCreate = resolve;
        })
      )
      .mockResolvedValue(makeNode('b-2'));

    const firstPromise = queueLinkBookmarkMove(first);
    const secondPromise = queueLinkBookmarkMove(second);

    // Yield one microtask so the first op reaches its pending create; the
    // second op must still not have started (same link ⇒ serialized).
    await Promise.resolve();
    expect(mockCreateLink).toHaveBeenCalledTimes(1);

    resolveFirstCreate!(makeNode('b-1'));
    await Promise.all([firstPromise, secondPromise]);

    expect(firstEvents).toEqual(['resolve', 'commit:b-1']);
    expect(secondEvents).toEqual(['resolve', 'commit:b-2']);
    // The second op deleted the FIRST op's creation (late binding), not the
    // stale id it would have seen at submission time.
    expect(mockDeleteLink).toHaveBeenNthCalledWith(1, 'b-old');
    expect(mockDeleteLink).toHaveBeenNthCalledWith(2, 'b-1');
    expect(mockCreateLink).toHaveBeenCalledTimes(2);
  });

  it('runs ops for different links in parallel', async () => {
    const resolvers: Array<(node: chrome.bookmarks.BookmarkTreeNode) => void> =
      [];
    mockCreateLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );

    const { request: first } = makeRequest({ linkId: 'link-1' });
    const { request: second } = makeRequest({ linkId: 'link-2' });

    const firstPromise = queueLinkBookmarkMove(first);
    const secondPromise = queueLinkBookmarkMove(second);

    // Yield one microtask: each link has its own chain, so both ops must have
    // reached their (pending) create without waiting on each other.
    await Promise.resolve();
    expect(mockCreateLink).toHaveBeenCalledTimes(2);

    resolvers[0](makeNode('b-1'));
    resolvers[1](makeNode('b-2'));
    await Promise.all([firstPromise, secondPromise]);

    expect(mockDeleteLink).toHaveBeenCalledWith('b-old');
    expect(mockDeleteLink).toHaveBeenCalledTimes(2);
  });
});
