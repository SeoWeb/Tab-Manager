// Tasks 5.4 / 5.5 / 5.7:
// - Matching between projects/collections and bookmark folders uses stored
//   bookmarkFolderId references ONLY — duplicate names never cross-link and
//   unreferenced folders are never adopted by name.
// - A vanished mirrored folder marks the local entity "mirror removed" and
//   NEVER deletes local data.
// - A folder re-appearing with the stored id restores the mapping.
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
import { bookmarkService } from '../../bookmarkService';
import { useAppStore } from '@/stores/appStore';

const mockBookmarkService = bookmarkService as jest.Mocked<
  typeof bookmarkService
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseAppStore = useAppStore as any;

function makeFolder(
  id: string,
  title: string
): chrome.bookmarks.BookmarkTreeNode {
  return {
    id,
    title,
    parentId: 'root-1',
    index: 0,
    dateAdded: Date.now(),
    dateGroupModified: Date.now(),
    unmodifiable: undefined,
    children: undefined,
    url: undefined,
  } as chrome.bookmarks.BookmarkTreeNode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setStore(projects: any[]): any {
  const mockStore = {
    tabManagerRootFolderId: 'root-1',
    projects,
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
  return mockStore;
}

describe('BookmarkSyncService: mirror removal + id-only matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bookmarkSyncService as any).isInitialized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bookmarkSyncService as any).syncInProgress = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bookmarkSyncService as any).suppressEchoes = false;
  });

  describe('missing mirrored project folder', () => {
    it('marks the project mirror-removed and keeps all local data', async () => {
      const mockStore = setStore([
        {
          id: 'p1',
          name: 'P1',
          bookmarkFolderId: 'gone-1',
          collections: [
            { id: 'c1', name: 'C1', bookmarkFolderId: null, links: [] },
          ],
        },
      ]);
      mockBookmarkService.getChildren.mockResolvedValue([]); // root is empty

      await bookmarkSyncService.performFullSync();

      // NO deletion of local entities.
      expect(mockStore.deleteProject).not.toHaveBeenCalled();

      // bookmarkFolderId moved aside into the companion field + flag set.
      expect(mockStore.updateProject).toHaveBeenCalledWith(
        'p1',
        {
          bookmarkFolderId: null,
          mirrorRemoved: true,
          mirrorRemovedFolderId: 'gone-1',
        },
        true
      );
      // The project (and its collections/links) stay in the store.
      expect(mockStore.projects).toHaveLength(1);
      expect(mockStore.projects[0].collections).toHaveLength(1);
    });

    it('restores the mapping when the folder reappears with the stored id', async () => {
      const mockStore = setStore([
        {
          id: 'p1',
          name: 'P1',
          bookmarkFolderId: null,
          mirrorRemoved: true,
          mirrorRemovedFolderId: 'back-1',
          collections: [],
        },
      ]);
      mockBookmarkService.getChildren
        .mockResolvedValueOnce([makeFolder('back-1', 'P1')]) // root children
        .mockResolvedValue([]); // project folder children

      await bookmarkSyncService.performFullSync();

      expect(mockStore.updateProject).toHaveBeenCalledWith(
        'p1',
        {
          bookmarkFolderId: 'back-1',
          mirrorRemoved: false,
          mirrorRemovedFolderId: null,
        },
        true
      );
      // Restoring must not create a duplicate project entity.
      expect(mockStore.addProject).not.toHaveBeenCalled();
    });
  });

  describe('missing mirrored collection folder', () => {
    it('marks the collection mirror-removed and keeps local links', async () => {
      const mockStore = setStore([
        {
          id: 'p1',
          name: 'P1',
          bookmarkFolderId: 'pf',
          collections: [
            {
              id: 'c1',
              name: 'C1',
              bookmarkFolderId: 'gone-c',
              links: [
                { id: 'l1', title: 'L', url: 'https://x', bookmarkId: 'b1' },
              ],
            },
          ],
        },
      ]);
      mockBookmarkService.getChildren
        .mockResolvedValueOnce([makeFolder('pf', 'P1')]) // root children
        .mockResolvedValue([]); // project folder children (collection gone)

      await bookmarkSyncService.performFullSync();

      expect(mockStore.deleteCollection).not.toHaveBeenCalled();
      expect(mockStore.deleteLink).not.toHaveBeenCalled();
      expect(mockStore.updateCollection).toHaveBeenCalledWith(
        'p1',
        'c1',
        {
          bookmarkFolderId: null,
          mirrorRemoved: true,
          mirrorRemovedFolderId: 'gone-c',
        },
        true
      );
      expect(mockStore.projects[0].collections).toHaveLength(1);
      expect(mockStore.projects[0].collections[0].links).toHaveLength(1);
    });

    it('restores the collection mapping when the folder reappears with the stored id', async () => {
      const mockStore = setStore([
        {
          id: 'p1',
          name: 'P1',
          bookmarkFolderId: 'pf',
          collections: [
            {
              id: 'c1',
              name: 'C1',
              bookmarkFolderId: null,
              mirrorRemoved: true,
              mirrorRemovedFolderId: 'back-c',
              links: [],
            },
          ],
        },
      ]);
      mockBookmarkService.getChildren
        .mockResolvedValueOnce([makeFolder('pf', 'P1')]) // root children
        .mockResolvedValueOnce([makeFolder('back-c', 'C1')]) // pf children
        .mockResolvedValue([]); // collection folder children

      await bookmarkSyncService.performFullSync();

      expect(mockStore.updateCollection).toHaveBeenCalledWith(
        'p1',
        'c1',
        {
          bookmarkFolderId: 'back-c',
          mirrorRemoved: false,
          mirrorRemovedFolderId: null,
        },
        true
      );
      expect(mockStore.addCollection).not.toHaveBeenCalled();
    });
  });

  describe('id-only matching', () => {
    it('never cross-links duplicate folder names by title', async () => {
      const mockStore = setStore([
        {
          id: 'p1',
          name: 'Same',
          bookmarkFolderId: 'f-1',
          collections: [],
        },
      ]);
      mockBookmarkService.getChildren
        .mockResolvedValueOnce([
          makeFolder('f-1', 'Same'),
          makeFolder('f-2', 'Same'),
        ]) // root children
        .mockResolvedValue([]); // children of f-1

      await bookmarkSyncService.performFullSync();

      // f-1 syncs to p1 by stored id. f-2 is unreferenced: it is adopted by
      // CREATION only (a fresh import project), never linked to p1 by name.
      expect(mockStore.addProject).toHaveBeenCalledTimes(1);

      const stampCalls = mockStore.updateProject.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ([, updates]: [string, any]) => updates?.bookmarkFolderId
      );
      expect(stampCalls).toHaveLength(0);
    });

    it('treats an unreferenced folder as import-by-creation, not by name', async () => {
      // A project exists with NO folder reference at all: a same-named folder
      // in the tree must not be attached to it.
      const mockStore = setStore([
        { id: 'p1', name: 'Orphan', bookmarkFolderId: null, collections: [] },
      ]);
      mockBookmarkService.getChildren
        .mockResolvedValueOnce([makeFolder('f-9', 'Orphan')]) // root children
        .mockResolvedValue([]); // children of f-9

      await bookmarkSyncService.performFullSync();

      // The folder was not adopted onto p1 by its display name.
      const stampCalls = mockStore.updateProject.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ([, updates]: [string, any]) => updates?.bookmarkFolderId === 'f-9'
      );
      expect(stampCalls).toHaveLength(0);
      // …it was imported as its own new project instead.
      expect(mockStore.addProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Orphan' }),
        { skipBookmarkCreation: true }
      );
    });
  });
});
