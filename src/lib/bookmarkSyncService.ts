// src/lib/bookmarkSyncService.ts

import { bookmarkService } from './bookmarkService';
import { useAppStore } from '@/stores/appStore';
import { ProjectSync } from './sync/projectSync';
import { SyncHandlers } from './sync/syncHandlers';
import { debugLog } from '@/lib/debugLog';

/** Trailing-edge debounce window for partial syncs (spec: 1 s). */
export const PARTIAL_SYNC_DEBOUNCE_MS = 1000;

/**
 * Service for bidirectional bookmark synchronization
 * Handles syncing changes from Chrome bookmarks back to the extension
 */
export class BookmarkSyncService {
  private isInitialized = false;
  public syncInProgress = false;
  /**
   * True while an extension-initiated bookmark write is in flight. Managed
   * exclusively by `bookmarkStorage.withSuppressedSyncEcho` with try/finally
   * so a throwing write always restores it (never timer-based).
   */
  public suppressEchoes = false;
  private projectSync = new ProjectSync();
  private syncHandlers = new SyncHandlers(this);

  /**
   * Stable, pre-bound listener references. Chrome's `removeListener` matches
   * listeners by identity, so the exact references passed to `addListener`
   * must be reused at teardown — the previous `.bind()` calls inside both
   * `initialize()` and `destroy()` created throwaway functions and removal
   * was a no-op, leaking duplicate listeners across re-initialization.
   */
  private readonly boundHandlers = {
    created: this.syncHandlers.handleBookmarkCreated.bind(this.syncHandlers),
    removed: this.syncHandlers.handleBookmarkRemoved.bind(this.syncHandlers),
    changed: this.syncHandlers.handleBookmarkChanged.bind(this.syncHandlers),
    moved: this.syncHandlers.handleBookmarkMoved.bind(this.syncHandlers),
  };

  /** Trailing-edge debounce state for partial syncs. */
  private partialSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPartialSyncFolderIds = new Set<string>();

  /**
   * Initialize the bookmark sync service
   * Sets up event listeners for bookmark changes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Set up Chrome bookmark event listeners (stable references, see
      // `boundHandlers` — destroy() must be able to remove these).
      if (typeof chrome !== 'undefined' && chrome.bookmarks) {
        chrome.bookmarks.onCreated.addListener(this.boundHandlers.created);
        chrome.bookmarks.onRemoved.addListener(this.boundHandlers.removed);
        chrome.bookmarks.onChanged.addListener(this.boundHandlers.changed);
        chrome.bookmarks.onMoved.addListener(this.boundHandlers.moved);
      }

      this.isInitialized = true;
      debugLog('BookmarkSyncService initialized');
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
      debugLog('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    debugLog('Starting full bookmark sync...');

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

      debugLog('Full bookmark sync completed');
    } catch (error) {
      console.error('Error during full sync:', error);
    } finally {
      this.syncInProgress = false;

      // Apply any bookmark events that arrived while this sync was running.
      // They were queued (coalesced per bookmark id) instead of dropped; each
      // drained event schedules a debounced partial sync, so a burst drains
      // into exactly one trailing sync.
      this.syncHandlers.drainQueuedEvents();
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
   * Perform a partial sync for a specific folder.
   *
   * Trailing-edge debounced: N events arriving within the 1 s window collapse
   * into a single sync that runs once after the changes settle. The affected
   * folder ids are accumulated (and coalesced) so a future per-subtree sync
   * can target exactly the changed areas.
   */
  async performPartialSync(folderId: string): Promise<void> {
    this.pendingPartialSyncFolderIds.add(folderId);

    if (this.partialSyncTimer) {
      clearTimeout(this.partialSyncTimer);
    }

    this.partialSyncTimer = setTimeout(() => {
      this.partialSyncTimer = null;
      const folderIds = Array.from(this.pendingPartialSyncFolderIds);
      this.pendingPartialSyncFolderIds.clear();

      if (folderIds.length > 0) {
        debugLog(`Debounced partial sync for folders: ${folderIds.join(', ')}`);
      }
      // A partial sync currently reconciles the managed subtree, which is
      // what performFullSync walks; the debounce is what matters here.
      void this.performFullSync();
    }, PARTIAL_SYNC_DEBOUNCE_MS);
  }

  /**
   * Clean up event listeners and timers.
   *
   * Removes the exact listener references registered in `initialize()` (see
   * `boundHandlers`), so teardown actually works and a destroy → re-create
   * cycle never double-handles events.
   */
  destroy(): void {
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.onCreated.removeListener(this.boundHandlers.created);
      chrome.bookmarks.onRemoved.removeListener(this.boundHandlers.removed);
      chrome.bookmarks.onChanged.removeListener(this.boundHandlers.changed);
      chrome.bookmarks.onMoved.removeListener(this.boundHandlers.moved);
    }

    // Cancel any pending debounced sync and drop queued-but-unapplied events;
    // a destroyed service must not fire work afterwards.
    if (this.partialSyncTimer) {
      clearTimeout(this.partialSyncTimer);
      this.partialSyncTimer = null;
    }
    this.pendingPartialSyncFolderIds.clear();
    this.syncHandlers.clearQueuedEvents();

    this.isInitialized = false;
    this.suppressEchoes = false;
    debugLog('BookmarkSyncService destroyed');
  }
}

// Export singleton instance
export const bookmarkSyncService = new BookmarkSyncService();
