import { bookmarkService } from '../bookmarkService';
import type { BookmarkSyncService } from './types';

export class SyncHandlers {
  constructor(private syncService: BookmarkSyncService) {}

  /**
   * Handle bookmark created event
   */
  async handleBookmarkCreated(
    id: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    if (this.syncService.syncInProgress) return;

    // Check if this bookmark is within our managed folders
    if (
      bookmark.parentId &&
      (await this.syncService.isWithinManagedFolders(bookmark.parentId))
    ) {
      // Trigger a partial sync for the affected area
      await this.syncService.performPartialSync(bookmark.parentId);
    }
  }

  /**
   * Handle bookmark removed event
   */
  async handleBookmarkRemoved(
    id: string,
    removeInfo: {
      parentId: string;
      index: number;
      node: chrome.bookmarks.BookmarkTreeNode;
    }
  ): Promise<void> {
    if (this.syncService.syncInProgress) return;

    // Check if this was within our managed folders
    if (await this.syncService.isWithinManagedFolders(removeInfo.parentId)) {
      // Trigger a partial sync for the affected area
      await this.syncService.performPartialSync(removeInfo.parentId);
    }
  }

  /**
   * Handle bookmark changed event
   */
  async handleBookmarkChanged(
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    changeInfo: { title?: string; url?: string }
  ): Promise<void> {
    if (this.syncService.syncInProgress) return;

    // Get the bookmark to check if it's in our managed folders
    const bookmark = await bookmarkService.getBookmarkNode(id);
    if (
      bookmark &&
      bookmark.parentId &&
      (await this.syncService.isWithinManagedFolders(bookmark.parentId))
    ) {
      // Trigger a partial sync for the affected area
      await this.syncService.performPartialSync(bookmark.parentId);
    }
  }

  /**
   * Handle bookmark moved event
   */
  async handleBookmarkMoved(
    id: string,
    moveInfo: {
      parentId: string;
      index: number;
      oldParentId: string;
      oldIndex: number;
    }
  ): Promise<void> {
    if (this.syncService.syncInProgress) return;

    // Check both old and new parent folders
    const affectedFolders = [moveInfo.oldParentId, moveInfo.parentId];

    for (const folderId of affectedFolders) {
      if (await this.syncService.isWithinManagedFolders(folderId)) {
        await this.syncService.performPartialSync(folderId);
      }
    }
  }
}
