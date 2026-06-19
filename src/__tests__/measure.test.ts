import { ProjectSync } from '../lib/sync/projectSync';

console.log = jest.fn();

jest.mock('../stores/appStore', () => {
  const mockProjects = Array(10)
    .fill(0)
    .map((_, i) => ({
      id: `p${i}`,
      name: `Folder ${i}`,
      bookmarkFolderId: `folder-${i}`,
    }));

  return {
    useAppStore: {
      getState: () => ({
        projects: mockProjects,
        addProject: jest.fn(),
        updateProject: jest.fn(),
        deleteProject: jest.fn(),
      }),
    },
  };
});

jest.mock('../lib/bookmarkService', () => ({
  bookmarkService: {
    getChildren: jest.fn().mockImplementation(async () => {
      // Simulate network/db delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      return [];
    }),
  },
}));

jest.mock('../lib/sync/collectionSync', () => {
  return {
    CollectionSync: jest.fn().mockImplementation(() => {
      return {
        syncCollections: jest.fn().mockImplementation(async () => {
          // Simulate network/db delay
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
      };
    }),
  };
});

describe('ProjectSync Performance', () => {
  it('measures baseline sync time', async () => {
    const sync = new ProjectSync();

    // Mock 10 bookmark folders.
    // This will trigger syncProject 10 times, each taking ~100ms
    const mockFolders = Array(10)
      .fill(0)
      .map(
        (_, i) =>
          ({
            id: `folder-${i}`,
            title: `Folder ${i}`,
            parentId: 'root',
          }) as chrome.bookmarks.BookmarkTreeNode
      );

    const start = performance.now();
    await sync.syncProjects(mockFolders);
    const end = performance.now();

    const executionTime = end - start;
    process.stdout.write(
      `\n--- BASELINE EXECUTION TIME: ${executionTime.toFixed(2)} ms ---\n\n`
    );
  });
});
