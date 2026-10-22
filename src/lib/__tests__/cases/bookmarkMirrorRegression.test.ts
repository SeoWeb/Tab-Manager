// Task 5.6 (cleanup-and-regression-tests): bookmark-mirror regression tests.
//
// Companion to the mocked-store suites in this directory — these run the REAL
// pipeline (BookmarkSyncService → ProjectSync/CollectionSync/LinkSync → the
// real zustand store) and assert on actual store STATE, not on action calls:
//
//  (a) queue-drain        — a bookmark event arriving mid-sync is queued and
//                           applied after the sync completes, exactly once
//                           (spec: bookmark-mirror-sync "Event during sync is
//                           applied afterwards" / "Burst is coalesced");
//  (b) debounce coalescing— a burst of 20 rapid events collapses into exactly
//                           one trailing sync, driven through the real event
//                           handlers with fake timers ("N rapid events cause
//                           one sync");
//  (c) duplicate-name non-linking — two identically named collection folders
//                           are matched by stored id only; the unreferenced
//                           same-named folder is never adopted onto the
//                           existing entity ("Duplicate folder names do not
//                           cross-link");
//  (d) folder disappearance — a vanished mirrored folder keeps ALL local data
//                           and sets mirrorRemoved/mirrorRemovedFolderId, and
//                           a re-created folder with the same stored id
//                           auto-restores the mapping ("Folder deletion leaves
//                           the project intact" / "Re-creating the folder
//                           restores the mirror").
//
// Mocks must be declared at the top of the test file so Jest registers them.
jest.mock('../../bookmarkService');
jest.mock('nanoid', () => {
  let counter = 0;
  return {
    __esModule: true,
    nanoid: () => `nid-${String(++counter).padStart(3, '0')}`,
    __resetForTests: () => {
      counter = 0;
    },
  };
});
jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  getInitials: () => '',
  isValidUrl: () => true,
  getFullUrl: (url: string) => url,
  getFaviconUrl: jest.fn(),
  preloadFavicon: jest.fn().mockResolvedValue(''),
}));

import { bookmarkSyncService } from '../../bookmarkSyncService';
import { PARTIAL_SYNC_DEBOUNCE_MS } from '../../bookmarkSyncService';
import { bookmarkService } from '../../bookmarkService';
import { useAppStore } from '@/stores/appStore';
import type { Collection, Link, Project } from '@/types';

const mockBookmarkService = bookmarkService as jest.Mocked<
  typeof bookmarkService
>;
const nanoidMock = jest.requireMock('nanoid') as {
  __resetForTests: () => void;
};

const ROOT = 'root-1';
const T0 = new Date('2024-01-01T00:00:00.000Z');

// Mock Chrome APIs (bookmark events only; no chrome.storage — the store's
// persist layer then no-ops safely, like it does without the extension API).
const mockChrome = {
  bookmarks: {
    onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
    onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    onMoved: { addListener: jest.fn(), removeListener: jest.fn() },
  },
};
// @ts-expect-error - Mocking global chrome for testing
global.chrome = mockChrome;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFolder(
  id: string,
  title: string,
  parentId: string
): chrome.bookmarks.BookmarkTreeNode {
  return { id, title, parentId, index: 0 } as chrome.bookmarks.BookmarkTreeNode;
}

function makeBookmarkNode(
  id: string,
  title: string,
  url: string,
  parentId: string
): chrome.bookmarks.BookmarkTreeNode {
  return {
    id,
    title,
    url,
    parentId,
    index: 0,
  } as chrome.bookmarks.BookmarkTreeNode;
}

function makeLink(
  overrides: Partial<Link> & { id: string; url: string }
): Link {
  return {
    title: 'Link',
    favIconUrl: '',
    tags: [],
    notes: '',
    order: 0,
    bookmarkId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeCollection(
  overrides: Partial<Collection> & { id: string; name: string }
): Collection {
  return {
    description: '',
    links: [],
    createdAt: T0,
    updatedAt: T0,
    bookmarkFolderId: null,
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<Project> & { id: string; name: string }
): Project {
  return {
    description: '',
    color: '#4285F4',
    icon: '📁',
    collections: [],
    createdAt: T0,
    updatedAt: T0,
    bookmarkFolderId: null,
    ...overrides,
  };
}

/** Point bookmarkService at an in-memory folder tree (id → children). */
function installTree(
  tree: Record<string, chrome.bookmarks.BookmarkTreeNode[]>
) {
  mockBookmarkService.getChildren.mockImplementation(
    async (folderId) => tree[folderId] ?? []
  );
  const nodesById = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  for (const nodes of Object.values(tree)) {
    for (const node of nodes) nodesById.set(node.id, node);
  }
  mockBookmarkService.getBookmarkNode.mockImplementation(async (id) => {
    // The root terminates the managed-folder walk (it is its own parent).
    if (id === ROOT) {
      return { id: ROOT, parentId: ROOT } as chrome.bookmarks.BookmarkTreeNode;
    }
    return nodesById.get(id) ?? null;
  });
}

function seedStore(projects: Project[]): void {
  useAppStore.setState({
    projects,
    tabManagerRootFolderId: ROOT,
    activeProjectId: projects[0]?.id ?? null,
  });
}

function p1(): Project {
  const project = useAppStore.getState().projects.find((p) => p.id === 'p1');
  if (!project) throw new Error('expected seeded project p1 to exist');
  return project;
}

/** The c1 collection's links (the queue-drain scenario's target). */
function c1Links(): Link[] {
  return p1().collections.find((c) => c.id === 'c1')?.links ?? [];
}

/** The SyncHandlers instance owned by the singleton service. */
function syncHandlers(): { queuedEventCount: number } {
  return (
    bookmarkSyncService as unknown as {
      syncHandlers: { queuedEventCount: number };
    }
  ).syncHandlers;
}

function lastRegisteredHandler(): (
  bookmarkId: string,
  node: chrome.bookmarks.BookmarkTreeNode
) => Promise<void> {
  const calls = mockChrome.bookmarks.onCreated.addListener.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('bookmarkSyncService was not initialized');
  return last[0] as (
    bookmarkId: string,
    node: chrome.bookmarks.BookmarkTreeNode
  ) => Promise<void>;
}

const flushMicrotasks = async (rounds = 30): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
};

// ---------------------------------------------------------------------------

describe('bookmark-mirror regression (task 5.6, real store)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nanoidMock.__resetForTests();
    // Kill any debounce timer / queued events a previous test left behind.
    bookmarkSyncService.destroy();
    (
      bookmarkSyncService as unknown as { syncInProgress: boolean }
    ).syncInProgress = false;
    (
      bookmarkSyncService as unknown as { suppressEchoes: boolean }
    ).suppressEchoes = false;
    useAppStore.setState({
      projects: [],
      tabManagerRootFolderId: null,
      activeProjectId: null,
    });
  });

  afterEach(() => {
    bookmarkSyncService.destroy();
    jest.useRealTimers();
  });

  // (a) spec: bookmark-mirror-sync → "Event during sync is applied afterwards"
  it('queue-drain: an event arriving mid-sync is applied after completion, exactly once', async () => {
    jest.useFakeTimers();
    await bookmarkSyncService.initialize();
    const createdHandler = lastRegisteredHandler();

    const tree: Record<string, chrome.bookmarks.BookmarkTreeNode[]> = {
      [ROOT]: [makeFolder('f-1', 'Proj', ROOT)],
      'f-1': [makeFolder('fc-1', 'C1', 'f-1')],
      'fc-1': [],
    };
    installTree(tree);

    // Hold the root listing open so the full sync stays in progress while the
    // user's bookmark event arrives.
    let releaseRoot: () => void = () => undefined;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    let holdRoot = true;
    mockBookmarkService.getChildren.mockImplementation((folderId) =>
      folderId === ROOT && holdRoot
        ? rootGate.then(() => tree[ROOT] ?? [])
        : Promise.resolve(tree[folderId] ?? [])
    );

    seedStore([
      makeProject({
        id: 'p1',
        name: 'Proj',
        bookmarkFolderId: 'f-1',
        collections: [
          makeCollection({ id: 'c1', name: 'C1', bookmarkFolderId: 'fc-1' }),
        ],
      }),
    ]);

    const syncPromise = bookmarkSyncService.performFullSync();
    await flushMicrotasks();
    expect(bookmarkSyncService.syncInProgress).toBe(true);

    // The user creates a bookmark while the sync is running: it must be
    // queued (not dropped, not applied yet).
    await createdHandler(
      'bm-new',
      makeBookmarkNode('bm-new', 'New', 'https://example.com/new', 'fc-1')
    );
    expect(syncHandlers().queuedEventCount).toBe(1);
    expect(c1Links()).toHaveLength(0);

    // Let the sync finish over a subtree that does NOT yet contain the new
    // bookmark (so only the post-drain sync can apply the queued event).
    releaseRoot();
    holdRoot = false;
    await syncPromise;
    await flushMicrotasks();
    expect(syncHandlers().queuedEventCount).toBe(0);

    // The drain scheduled the trailing debounced sync — nothing applied yet.
    jest.advanceTimersByTime(PARTIAL_SYNC_DEBOUNCE_MS - 1);
    expect(c1Links()).toHaveLength(0);

    // The bookmark lands in Chrome's tree inside the debounce window; the
    // trailing sync picks it up.
    tree['fc-1'] = [
      makeBookmarkNode('bm-new', 'New', 'https://example.com/new', 'fc-1'),
    ];

    await jest.advanceTimersByTimeAsync(PARTIAL_SYNC_DEBOUNCE_MS);
    await flushMicrotasks();

    const links = c1Links();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      title: 'New',
      url: 'https://example.com/new',
      bookmarkId: 'bm-new',
    });

    // Re-running the sync reconciles the same subtree without duplicating.
    await bookmarkSyncService.performFullSync();
    await flushMicrotasks();
    expect(c1Links()).toHaveLength(1);
  });

  // (b) spec: bookmark-mirror-sync → "N rapid events cause one sync"
  it('debounce coalescing: a burst of 20 bookmark events collapses into exactly one trailing sync', async () => {
    jest.useFakeTimers();
    await bookmarkSyncService.initialize();
    const createdHandler = lastRegisteredHandler();
    const fullSyncSpy = jest
      .spyOn(bookmarkSyncService, 'performFullSync')
      .mockResolvedValue(undefined);

    installTree({
      [ROOT]: [makeFolder('f-1', 'Proj', ROOT)],
      'f-1': [makeFolder('fc-1', 'C1', 'f-1')],
    });
    seedStore([
      makeProject({ id: 'p1', name: 'Proj', bookmarkFolderId: 'f-1' }),
    ]);

    try {
      // 20 distinct bookmarks created inside one debounce window, through the
      // real event handlers (no sync in progress → straight to the debouncer).
      for (let i = 0; i < 20; i++) {
        await createdHandler(
          `bm-${i}`,
          makeBookmarkNode(
            `bm-${i}`,
            `B${i}`,
            `https://example.com/${i}`,
            'fc-1'
          )
        );
      }

      // No leading-edge run; nothing before the window closes.
      expect(fullSyncSpy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(PARTIAL_SYNC_DEBOUNCE_MS - 1);
      expect(fullSyncSpy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(fullSyncSpy).toHaveBeenCalledTimes(1);
    } finally {
      // Restore the spy — a leaked mock would silently no-op the syncs of
      // every test after this one.
      fullSyncSpy.mockRestore();
    }
  });

  // (c) spec: bookmark-mirror-sync → "Duplicate folder names do not cross-link"
  it('duplicate-name non-linking: two identically named collection folders never cross-link; the unreferenced one is not adopted', async () => {
    installTree({
      [ROOT]: [makeFolder('f-1', 'Proj', ROOT)],
      // Two sibling folders with the SAME title under one project.
      'f-1': [
        makeFolder('fc-1', 'Docs', 'f-1'),
        makeFolder('fc-2', 'Docs', 'f-1'),
      ],
      'fc-1': [],
      'fc-2': [makeBookmarkNode('bm-x', 'X', 'https://example.com/x', 'fc-2')],
    });
    seedStore([
      makeProject({
        id: 'p1',
        name: 'Proj',
        bookmarkFolderId: 'f-1',
        collections: [
          makeCollection({ id: 'c1', name: 'Docs', bookmarkFolderId: 'fc-1' }),
        ],
      }),
    ]);

    await bookmarkSyncService.performFullSync();
    await flushMicrotasks();

    const project = p1();
    expect(project.collections).toHaveLength(2);
    const seeded = project.collections.find((c) => c.id === 'c1');
    const imported = project.collections.find((c) => c.id !== 'c1');
    expect(seeded).toBeDefined();
    expect(imported).toBeDefined();

    // Matching is by stored id ONLY: c1 keeps fc-1, and fc-2's content never
    // bleeds into it (no adoption by display name).
    expect(seeded?.bookmarkFolderId).toBe('fc-1');
    expect(seeded?.links).toHaveLength(0);

    // The unreferenced same-named folder was imported as its own collection
    // (creation, linked by the id it created), never merged into c1.
    expect(imported?.name).toBe('Docs');
    expect(imported?.bookmarkFolderId).toBe('fc-2');
    expect(imported?.links).toHaveLength(1);
    expect(imported?.links[0]).toMatchObject({ bookmarkId: 'bm-x' });

    // And no duplicate project was created for either folder.
    expect(useAppStore.getState().projects).toHaveLength(1);
  });

  // (d) spec: bookmark-mirror-sync → "Folder deletion leaves the project
  //     intact" / "Re-creating the folder restores the mirror"
  it('folder-disappearance: local data survives with the mirror flag set, and the re-created same-id folder auto-restores', async () => {
    const tree: Record<string, chrome.bookmarks.BookmarkTreeNode[]> = {
      [ROOT]: [],
    };
    installTree(tree);
    seedStore([
      makeProject({
        id: 'p1',
        name: 'P1',
        bookmarkFolderId: 'gone-1',
        collections: [
          makeCollection({
            id: 'c1',
            name: 'C1',
            bookmarkFolderId: 'gc-1',
            links: [
              makeLink({
                id: 'l1',
                title: 'Keep',
                url: 'https://example.com/keep',
                bookmarkId: 'b1',
              }),
            ],
          }),
        ],
      }),
    ]);

    // 1) The mirrored folder is gone from Chrome: flag it, delete NOTHING.
    await bookmarkSyncService.performFullSync();
    await flushMicrotasks();

    let project = p1();
    expect(project.bookmarkFolderId).toBeNull();
    expect(project.mirrorRemoved).toBe(true);
    expect(project.mirrorRemovedFolderId).toBe('gone-1');
    expect(useAppStore.getState().projects).toHaveLength(1);
    expect(project.collections.map((c) => c.id)).toEqual(['c1']);
    expect(project.collections[0].links[0]).toMatchObject({
      id: 'l1',
      title: 'Keep',
      url: 'https://example.com/keep',
      bookmarkId: 'b1',
    });

    // 2) The user re-creates a folder with the SAME id: the mapping restores.
    tree[ROOT] = [makeFolder('gone-1', 'P1', ROOT)];
    tree['gone-1'] = [makeFolder('gc-1', 'C1', 'gone-1')];
    tree['gc-1'] = [
      makeBookmarkNode('b1', 'Keep', 'https://example.com/keep', 'gc-1'),
    ];

    await bookmarkSyncService.performFullSync();
    await flushMicrotasks();

    project = p1();
    expect(project.bookmarkFolderId).toBe('gone-1');
    expect(project.mirrorRemoved).toBe(false);
    expect(project.mirrorRemovedFolderId).toBeNull();
    // Restored in place — not duplicated, and the collection/link data that
    // survived step 1 is still the single copy.
    expect(useAppStore.getState().projects).toHaveLength(1);
    expect(project.collections).toHaveLength(1);
    expect(project.collections[0].id).toBe('c1');
    expect(project.collections[0].links).toHaveLength(1);
    expect(project.collections[0].links[0]).toMatchObject({
      id: 'l1',
      bookmarkId: 'b1',
    });
  });
});
