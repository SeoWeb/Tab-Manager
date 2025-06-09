// src/lib/bookmarkSyncService.ts

import { bookmarkService } from './bookmarkService';
import { useAppStore } from '@/stores/appStore';
import { ProjectSync } from './sync/projectSync';
import { SyncHandlers } from './sync/syncHandlers';

/**
 * Service for bidirectional bookmark synchronization
 * Handles syncing changes from Chrome bookmarks back to the extension
 */
export class BookmarkSyncService {
  private isInitialized = false;
  public syncInProgress = false;
  private projectSync = new ProjectSync();
  private syncHandlers = new SyncHandlers(this);

  /**
   * Initialize the bookmark sync service
   * Sets up event listeners for bookmark changes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Set up Chrome bookmark event listeners
      if (chrome.bookmarks) {
        chrome.bookmarks.onCreated.addListener(
          this.syncHandlers.handleBookmarkCreated.bind(this.syncHandlers)
        );
        chrome.bookmarks.onRemoved.addListener(
          this.syncHandlers.handleBookmarkRemoved.bind(this.syncHandlers)
        );
        chrome.bookmarks.onChanged.addListener(
          this.syncHandlers.handleBookmarkChanged.bind(this.syncHandlers)
        );
        chrome.bookmarks.onMoved.addListener(
          this.syncHandlers.handleBookmarkMoved.bind(this.syncHandlers)
        );
      }

      this.isInitialized = true;
      console.log('BookmarkSyncService initialized');
    } catch (error) {
      console.error('Failed to initialize BookmarkSyncService:', error);
    }
  }

  /**
   * Perform a full sync from bookmarks to extension data
   * This reconciles any differences between bookmarks and extension state
   */
  async performFullSync(): Promise<void> {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    console.log('Starting full bookmark sync...');

    try {
      const store = useAppStore.getState();
      const rootFolderId = store.tabManagerRootFolderId;

      if (!rootFolderId) {
        console.warn('No root folder ID found, cannot perform sync');
        return;
      }

      // Get all bookmark folders under the root
      const rootChildren = await bookmarkService.getChildren(rootFolderId);
      const projectFolders = rootChildren.filter((node) => !node.url); // Only folders

      // Sync projects
      await this.projectSync.syncProjects(projectFolders);

      console.log('Full bookmark sync completed');
    } catch (error) {
      console.error('Error during full sync:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Check if a folder is within our managed bookmark folders
   */
  async isWithinManagedFolders(folderId?: string): Promise<boolean> {
    if (!folderId) return false;

    const store = useAppStore.getState();
    const rootFolderId = store.tabManagerRootFolderId;

    if (!rootFolderId) return false;

    // Check if this folder is the root folder or a descendant
    let currentId = folderId;
    while (currentId) {
      if (currentId === rootFolderId) return true;

      const node = await bookmarkService.getBookmarkNode(currentId);
      if (!node || !node.parentId) break;

      currentId = node.parentId;
    }

    return false;
  }

  /**
   * Perform a partial sync for a specific folder
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async performPartialSync(_folderId: string): Promise<void> {
    // For now, just trigger a full sync
    // In the future, this could be optimized to only sync the affected subtree
    setTimeout(() => this.performFullSync(), 1000); // Debounce multiple rapid changes
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (chrome.bookmarks) {
      chrome.bookmarks.onCreated.removeListener(
        this.syncHandlers.handleBookmarkCreated.bind(this.syncHandlers)
      );
      chrome.bookmarks.onRemoved.removeListener(
        this.syncHandlers.handleBookmarkRemoved.bind(this.syncHandlers)
      );
      chrome.bookmarks.onChanged.removeListener(
        this.syncHandlers.handleBookmarkChanged.bind(this.syncHandlers)
      );
      chrome.bookmarks.onMoved.removeListener(
        this.syncHandlers.handleBookmarkMoved.bind(this.syncHandlers)
      );
    }

    this.isInitialized = false;
    console.log('BookmarkSyncService destroyed');
  }
}

// Export singleton instance
export const bookmarkSyncService = new BookmarkSyncService();
