import { bookmarkService } from '@/lib/bookmarkService';
import { useAppStore } from '@/stores/appStore';
import type { Collection } from '@/types';
import { LinkSync } from './linkSync';

export class CollectionSync {
  private linkSync = new LinkSync();

  /**
   * Sync collections from bookmark subfolders.
   *
   * Matching rules mirror ProjectSync: folders are tied to collections by
   * `bookmarkFolderId` only (plus the `mirrorRemovedFolderId` restore path) —
   * display names are never used to associate a folder with an entity.
   */
  async syncCollections(
    projectId: string,
    bookmarkCollectionFolders: chrome.bookmarks.BookmarkTreeNode[]
  ): Promise<void> {
    const store = useAppStore.getState();
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return;

    // Pre-calculate lookup maps for O(1) lookups (bookmark folder id → collection)
    const collectionByBookmarkId = new Map<string, Collection>();
    for (const collection of project.collections) {
      if (collection.bookmarkFolderId) {
        collectionByBookmarkId.set(collection.bookmarkFolderId, collection);
      }
    }

    const bookmarkExistsSet = new Set<string>();
    for (const bf of bookmarkCollectionFolders) {
      bookmarkExistsSet.add(bf.id);
    }

    // Find collections that exist in bookmarks but not in extension
    const syncPromises = bookmarkCollectionFolders.map(
      async (bookmarkFolder) => {
        const existingCollection = collectionByBookmarkId.get(
          bookmarkFolder.id
        );

        if (existingCollection) {
          // Sync existing collection
          await this.syncCollection(
            projectId,
            existingCollection,
            bookmarkFolder
          );
          return;
        }

        // A mirrored folder that previously vanished restores its mapping
        // when it re-appears with the same stored id.
        const removedCollection = project.collections.find(
          (c) =>
            c.mirrorRemoved && c.mirrorRemovedFolderId === bookmarkFolder.id
        );
        if (removedCollection) {
          store.updateCollection(
            projectId,
            removedCollection.id,
            {
              bookmarkFolderId: bookmarkFolder.id,
              mirrorRemoved: false,
              mirrorRemovedFolderId: null,
            },
            true
          );
          await this.syncCollection(
            projectId,
            { ...removedCollection, bookmarkFolderId: bookmarkFolder.id },
            bookmarkFolder
          );
          return;
        }

        // Create new collection from (currently unreferenced) bookmark
        // folder, linking it by id — never by name.
        await this.createCollectionFromBookmark(projectId, bookmarkFolder);
      }
    );

    await Promise.all(syncPromises);

    // Missing mirrored folders: mark the collection "mirror removed" but NEVER
    // delete local data. Read FRESH state after the awaits above — the
    // pre-await `project` snapshot is stale (create/sync steps mutate it).
    const freshProject = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId);
    if (!freshProject) return;

    for (const collection of freshProject.collections) {
      const mirrorId =
        collection.bookmarkFolderId ?? collection.mirrorRemovedFolderId ?? null;
      if (!mirrorId || bookmarkExistsSet.has(mirrorId)) continue;
      if (collection.mirrorRemoved) continue; // already marked

      console.warn(
        `[CollectionSync] Bookmark folder "${mirrorId}" for collection "${collection.name}" is gone; marking mirror removed (local data kept).`
      );
      store.updateCollection(
        projectId,
        collection.id,
        {
          bookmarkFolderId: null,
          mirrorRemoved: true,
          mirrorRemovedFolderId: mirrorId,
        },
        true
      );
    }
  }

  /**
   * Create a new collection from a bookmark folder
   */
  private async createCollectionFromBookmark(
    projectId: string,
    bookmarkFolder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    const store = useAppStore.getState();

    const collectionData = {
      name: bookmarkFolder.title || 'Untitled Collection',
      description: 'Imported from bookmarks',
      color: undefined,
    };

    // Capture the existing collection ids BEFORE the insert so the newly added
    // collection can be identified by id. (Previously this matched by display
    // name, which mislinked collections when duplicate folder titles existed.)
    const existingIds = new Set(
      (store.projects.find((p) => p.id === projectId)?.collections ?? []).map(
        (c) => c.id
      )
    );
    store.addCollection(projectId, collectionData, true); // Skip bookmark creation since we're syncing FROM bookmarks

    // The newly created collection is the one whose id we have not seen before.
    const updatedProject = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId);
    const newCollection = updatedProject?.collections.find(
      (c) => !existingIds.has(c.id)
    );

    if (newCollection) {
      store.updateCollection(
        projectId,
        newCollection.id,
        { bookmarkFolderId: bookmarkFolder.id },
        true
      );

      // Sync links for this collection
      const bookmarkLinks = await bookmarkService.getChildren(
        bookmarkFolder.id
      );
      await this.linkSync.syncLinks(
        projectId,
        newCollection.id,
        bookmarkLinks.filter((node) => node.url)
      );
    } else {
      // The insert did not yield a new entity (should not happen); report the
      // folder as unreferenced instead of guessing by name.
      console.warn(
        `[CollectionSync] Could not locate the collection created for bookmark folder "${bookmarkFolder.id}"; folder left unreferenced.`
      );
    }
  }

  /**
   * Sync an existing collection with its bookmark folder
   */
  private async syncCollection(
    projectId: string,
    collection: Collection,
    bookmarkFolder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    const store = useAppStore.getState();

    // Check if collection name changed in bookmarks
    if (collection.name !== bookmarkFolder.title) {
      store.updateCollection(
        projectId,
        collection.id,
        { name: bookmarkFolder.title || collection.name },
        true
      );
    }

    // Sync links
    const bookmarkLinks = await bookmarkService.getChildren(bookmarkFolder.id);
    await this.linkSync.syncLinks(
      projectId,
      collection.id,
      bookmarkLinks.filter((node) => node.url)
    );
  }
}
