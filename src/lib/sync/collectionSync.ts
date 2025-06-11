import { bookmarkService } from '../bookmarkService';
import { useAppStore } from '@/stores/appStore';
import type { Collection } from '@/types';
import { LinkSync } from './linkSync';

export class CollectionSync {
  private linkSync = new LinkSync();

  /**
   * Sync collections from bookmark subfolders
   */
  async syncCollections(
    projectId: string,
    bookmarkCollectionFolders: chrome.bookmarks.BookmarkTreeNode[]
  ): Promise<void> {
    const store = useAppStore.getState();
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return;

    // Find collections that exist in bookmarks but not in extension
    for (const bookmarkFolder of bookmarkCollectionFolders) {
      const existingCollection = project.collections.find(
        (c) => c.bookmarkFolderId === bookmarkFolder.id
      );

      if (!existingCollection) {
        // Create new collection from bookmark folder
        await this.createCollectionFromBookmark(projectId, bookmarkFolder);
      } else {
        // Sync existing collection
        await this.syncCollection(
          projectId,
          existingCollection,
          bookmarkFolder
        );
      }
    }

    // Find collections that exist in extension but not in bookmarks (they were deleted)
    for (const collection of project.collections) {
      if (collection.bookmarkFolderId) {
        const bookmarkExists = bookmarkCollectionFolders.find(
          (bf) => bf.id === collection.bookmarkFolderId
        );
        if (!bookmarkExists) {
          // Collection's bookmark folder was deleted, remove collection
          console.log(
            `Collection "${collection.name}" bookmark folder was deleted, removing collection`
          );
          store.deleteCollection(projectId, collection.id);
        }
      }
    }
  }

  /**
   * Create a new collection from a bookmark folder
   */
  private async createCollectionFromBookmark(
    projectId: string,
    bookmarkFolder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    console.log(
      `Creating collection from bookmark folder: ${bookmarkFolder.title}`
    );

    const store = useAppStore.getState();

    const collectionData = {
      name: bookmarkFolder.title || 'Untitled Collection',
      description: 'Imported from bookmarks',
      color: undefined,
    };

    store.addCollection(projectId, collectionData, true); // Skip bookmark creation since we're syncing FROM bookmarks

    // Find the newly created collection and update its bookmark folder ID
    const updatedProject = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId);
    const newCollection = updatedProject?.collections.find(
      (c) => c.name === collectionData.name && !c.bookmarkFolderId
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
      console.log(
        `Collection name changed in bookmarks: "${collection.name}" -> "${bookmarkFolder.title}"`
      );
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
