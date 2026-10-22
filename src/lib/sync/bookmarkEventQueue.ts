// src/lib/sync/bookmarkEventQueue.ts

/**
 * Bounded, coalescing queue for bookmark-change events that arrive while a
 * bookmark sync is in progress.
 *
 * Previously, SyncHandlers dropped any event that arrived mid-sync
 * (`if (syncInProgress) return`), so a user editing bookmarks during a sync
 * silently lost those changes. Events are now enqueued here and drained by the
 * sync service once the in-progress sync completes.
 *
 * - Coalescing: keyed by bookmark id; a newer event for the same id replaces
 *   the older one (only the latest state per id is meaningful — the post-sync
 *   partial sync reconciles full subtree state anyway).
 * - Bounded: at most `maxSize` distinct ids are retained. When the cap is hit,
 *   the oldest queued id is evicted to make room (insertion-order FIFO via
 *   Map's iteration order).
 */

export type BookmarkEventType = 'created' | 'removed' | 'changed' | 'moved';

export interface QueuedBookmarkEvent {
  type: BookmarkEventType;
  /** Chrome bookmark/node id this event is about; the coalescing key. */
  bookmarkId: string;
  /** Original handler payload (BookmarkTreeNode / removeInfo / changeInfo / moveInfo). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  /** Timestamp (ms) the event was enqueued; diagnostics only. */
  enqueuedAt: number;
}

/** Cap on distinct queued bookmark ids so a pathological burst cannot grow without limit. */
export const BOOKMARK_EVENT_QUEUE_MAX_SIZE = 500;

export class BookmarkEventQueue {
  private events = new Map<string, QueuedBookmarkEvent>();
  private readonly maxSize: number;

  constructor(maxSize: number = BOOKMARK_EVENT_QUEUE_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Add (or coalesce) an event. If an event for the same bookmark id is
   * already queued, it is replaced by this newer one. Enforcing the bound
   * evicts the oldest queued id.
   */
  enqueue(
    type: BookmarkEventType,
    bookmarkId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
  ): void {
    // Re-inserting (delete + set) moves an existing id to the back so the Map
    // stays in recency order for eviction.
    this.events.delete(bookmarkId);

    if (this.events.size >= this.maxSize) {
      const oldestId = this.events.keys().next().value;
      if (oldestId !== undefined) {
        this.events.delete(oldestId);
      }
    }

    this.events.set(bookmarkId, {
      type,
      bookmarkId,
      payload,
      enqueuedAt: Date.now(),
    });
  }

  /** Number of distinct queued bookmark ids. */
  get size(): number {
    return this.events.size;
  }

  get isEmpty(): boolean {
    return this.events.size === 0;
  }

  has(bookmarkId: string): boolean {
    return this.events.has(bookmarkId);
  }

  peek(bookmarkId: string): QueuedBookmarkEvent | undefined {
    return this.events.get(bookmarkId);
  }

  /**
   * Remove and return all queued events in insertion (oldest-first) order,
   * leaving the queue empty.
   */
  drain(): QueuedBookmarkEvent[] {
    const drained = Array.from(this.events.values());
    this.events.clear();
    return drained;
  }

  /** Drop all queued events without processing them. */
  clear(): void {
    this.events.clear();
  }
}
