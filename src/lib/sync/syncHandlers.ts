// src/lib/sync/syncHandlers.ts

import { bookmarkService } from '@/lib/bookmarkService';
import { BookmarkEventQueue } from './bookmarkEventQueue';
import type { BookmarkSyncService } from './types';

export class SyncHandlers {
  private eventQueue = new BookmarkEventQueue();

  constructor(private syncService: BookmarkSyncService) {}

  /**
   * Whether an event for the given bookmark id is currently queued.
   * (Exposed mainly for tests and diagnostics.)
   */
  isQueued(bookmarkId: string): boolean {
    return this.eventQueue.has(bookmarkId);
  }

  get queuedEventCount(): number {
    return this.eventQueue.size;
  }

  /**
   * Drain (and process) all events that were queued while a sync was in
   * progress. Called by the sync service once the in-progress sync completes,
   * so nothing that arrived mid-sync is lost. Each drained event goes through
   * the normal handler path; the handlers' debounced partial sync coalesces
   * the whole burst into a single trailing sync.
   */
  drainQueuedEvents(): void {
    if (this.eventQueue.isEmpty) return;

    const drained = this.eventQueue.drain();
    for (const event of drained) {
      // One malformed event must not prevent the rest of the burst from
      // being applied.
      void this.dispatch(event.type, event.bookmarkId, event.payload).catch(
        (error) => {
          console.error(
            `Error processing queued bookmark ${event.type} event for ${event.bookmarkId}:`,
            error
          );
        }
      );
    }
  }

  /** Drop all queued events without processing them (teardown). */
  clearQueuedEvents(): void {
    this.eventQueue.clear();
  }

  /**
   * Route a bookmark event through the appropriate handler. Events arriving
   * during an in-progress sync are queued (coalesced by bookmark id) instead
   * of dropped; events arriving while the extension itself is writing
   * bookmarks are dropped as self-triggered echoes.
   */
  private async handle(
    type: 'created' | 'removed' | 'changed' | 'moved',
    bookmarkId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any,
    process: () => Promise<void>
  ): Promise<void> {
    // Self-triggered echo of an extension-initiated bookmark write: drop.
    // The suppression flag is managed with try/finally around the write in
    // bookmarkStorage.withSuppressedSyncEcho.
    if (this.syncService.suppressEchoes) return;

    // A sync is in flight: queue (coalescing per bookmark id) so the change is
    // applied after the sync completes instead of being lost.
    if (this.syncService.syncInProgress) {
      this.eventQueue.enqueue(type, bookmarkId, payload);
      return;
    }

    await process();
  }

  private dispatch(
    type: 'created' | 'removed' | 'changed' | 'moved',
    bookmarkId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
  ): Promise<void> {
    switch (type) {
      case 'created':
        return this.handleBookmarkCreated(bookmarkId, payload);
      case 'removed':
        return this.handleBookmarkRemoved(bookmarkId, payload);
      case 'changed':
        return this.handleBookmarkChanged(bookmarkId, payload);
      case 'moved':
        return this.handleBookmarkMoved(bookmarkId, payload);
    }
  }

  /**
   * Handle bookmark created event
   */
  async handleBookmarkCreated(
    id: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    await this.handle('created', id, bookmark, async () => {
      // Check if this bookmark is within our managed folders
      if (
        bookmark.parentId &&
        (await this.syncService.isWithinManagedFolders(bookmark.parentId))
      ) {
        // Trigger a partial sync for the affected area
        await this.syncService.performPartialSync(bookmark.parentId);
      }
    });
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
    await this.handle('removed', id, removeInfo, async () => {
      // Check if this was within our managed folders
      if (await this.syncService.isWithinManagedFolders(removeInfo.parentId)) {
        // Trigger a partial sync for the affected area
        await this.syncService.performPartialSync(removeInfo.parentId);
      }
    });
  }

  /**
   * Handle bookmark changed event
   */
  async handleBookmarkChanged(
    id: string,
    changeInfo: { title?: string; url?: string }
  ): Promise<void> {
    await this.handle('changed', id, changeInfo, async () => {
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
    });
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
    await this.handle('moved', id, moveInfo, async () => {
      // Check both old and new parent folders
      const affectedFolders = [moveInfo.oldParentId, moveInfo.parentId];

      for (const folderId of affectedFolders) {
        if (await this.syncService.isWithinManagedFolders(folderId)) {
          await this.syncService.performPartialSync(folderId);
        }
      }
    });
  }
}
