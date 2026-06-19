// Benchmark script for collectionSync optimization
import { performance } from 'perf_hooks';

// Mocks for benchmarking
type Collection = { id: string; name: string; bookmarkFolderId?: string };
type BookmarkTreeNode = { id: string; title: string };
type Project = { id: string; collections: Collection[] };

// Original unoptimized logic to establish a baseline
function syncCollectionsOriginal(
  project: Project,
  bookmarkCollectionFolders: BookmarkTreeNode[]
) {
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  // Find collections that exist in bookmarks but not in extension
  for (const bookmarkFolder of bookmarkCollectionFolders) {
    const existingCollection = project.collections.find(
      (c) => c.bookmarkFolderId === bookmarkFolder.id
    );

    if (!existingCollection) {
      createdCount++;
    } else {
      updatedCount++;
    }
  }

  // Find collections that exist in extension but not in bookmarks
  for (const collection of project.collections) {
    if (collection.bookmarkFolderId) {
      const bookmarkExists = bookmarkCollectionFolders.find(
        (bf) => bf.id === collection.bookmarkFolderId
      );
      if (!bookmarkExists) {
        deletedCount++;
      }
    }
  }

  return { createdCount, updatedCount, deletedCount };
}

// Data Setup
const NUM_ITEMS = 100;

const bookmarkCollectionFolders: BookmarkTreeNode[] = [];
for (let i = 0; i < NUM_ITEMS; i++) {
  bookmarkCollectionFolders.push({
    id: `bf-${i}`,
    title: `Folder ${i}`,
  });
}

const project: Project = {
  id: 'proj-1',
  collections: [],
};

// 80% matches, 10% new, 10% deleted
for (let i = 0; i < NUM_ITEMS; i++) {
  if (i < NUM_ITEMS * 0.8) {
    // Matches
    project.collections.push({
      id: `col-${i}`,
      name: `Collection ${i}`,
      bookmarkFolderId: `bf-${i}`,
    });
  } else if (i >= NUM_ITEMS * 0.8 && i < NUM_ITEMS * 0.9) {
    // Deleted from bookmarks (exists in project only)
    project.collections.push({
      id: `col-${i}`,
      name: `Collection ${i}`,
      bookmarkFolderId: `deleted-bf-${i}`,
    });
  }
}

// Warmup
for (let i = 0; i < 1000; i++) {
  syncCollectionsOriginal(project, bookmarkCollectionFolders);
}

const ITERATIONS = 10000;

console.log(`Starting benchmark for N=${NUM_ITEMS}`);

const start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  syncCollectionsOriginal(project, bookmarkCollectionFolders);
}
const end = performance.now();

console.log(
  `Baseline Execution Time (Original) for ${ITERATIONS} iterations: ${(end - start).toFixed(2)} ms`
);

// Optimized logic
function syncCollectionsOptimized(
  project: Project,
  bookmarkCollectionFolders: BookmarkTreeNode[]
) {
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  // Pre-calculate maps
  const collectionByBookmarkId = new Map<string, Collection>();
  for (const collection of project.collections) {
    if (collection.bookmarkFolderId) {
      collectionByBookmarkId.set(collection.bookmarkFolderId, collection);
    }
  }

  const bookmarkExistsMap = new Set<string>();
  for (const bf of bookmarkCollectionFolders) {
    bookmarkExistsMap.add(bf.id);
  }

  // Find collections that exist in bookmarks but not in extension
  for (const bookmarkFolder of bookmarkCollectionFolders) {
    const existingCollection = collectionByBookmarkId.get(bookmarkFolder.id);

    if (!existingCollection) {
      createdCount++;
    } else {
      updatedCount++;
    }
  }

  // Find collections that exist in extension but not in bookmarks
  for (const collection of project.collections) {
    if (collection.bookmarkFolderId) {
      if (!bookmarkExistsMap.has(collection.bookmarkFolderId)) {
        deletedCount++;
      }
    }
  }

  return { createdCount, updatedCount, deletedCount };
}

// Warmup optimized
for (let i = 0; i < 1000; i++) {
  syncCollectionsOptimized(project, bookmarkCollectionFolders);
}

const startOptimized = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  syncCollectionsOptimized(project, bookmarkCollectionFolders);
}
const endOptimized = performance.now();

console.log(
  `Optimized Execution Time for ${ITERATIONS} iterations: ${(endOptimized - startOptimized).toFixed(2)} ms`
);
const speedup = ((end - start) / (endOptimized - startOptimized)).toFixed(2);
console.log(`Speedup: ${speedup}x`);
