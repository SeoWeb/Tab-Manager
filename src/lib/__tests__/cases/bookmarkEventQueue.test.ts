// Pure unit tests for the bounded, coalescing BookmarkEventQueue (task 5.1).
import {
  BOOKMARK_EVENT_QUEUE_MAX_SIZE,
  BookmarkEventQueue,
} from '../../sync/bookmarkEventQueue';

describe('BookmarkEventQueue', () => {
  it('drains events in insertion order and empties the queue', () => {
    const queue = new BookmarkEventQueue();

    queue.enqueue('created', 'bm-1', { parentId: 'f-1' });
    queue.enqueue('removed', 'bm-2', { parentId: 'f-1' });

    expect(queue.size).toBe(2);
    expect(queue.isEmpty).toBe(false);

    const drained = queue.drain();
    expect(drained.map((e) => e.bookmarkId)).toEqual(['bm-1', 'bm-2']);
    expect(drained[0].type).toBe('created');
    expect(drained[1].type).toBe('removed');
    expect(queue.isEmpty).toBe(true);
    expect(queue.drain()).toEqual([]);
  });

  it('coalesces bursts for the same bookmark id, keeping only the latest event', () => {
    const queue = new BookmarkEventQueue();

    queue.enqueue('created', 'bm-1', { version: 1 });
    queue.enqueue('changed', 'bm-1', { version: 2 });
    queue.enqueue('moved', 'bm-1', { version: 3 });

    // Three events for one id collapse into a single entry.
    expect(queue.size).toBe(1);

    const [event] = queue.drain();
    expect(event.bookmarkId).toBe('bm-1');
    expect(event.type).toBe('moved');
    expect(event.payload).toEqual({ version: 3 });
  });

  it('keeps distinct bookmark ids independent', () => {
    const queue = new BookmarkEventQueue();

    queue.enqueue('created', 'bm-1', { v: 1 });
    queue.enqueue('created', 'bm-2', { v: 2 });
    queue.enqueue('changed', 'bm-1', { v: 3 });

    expect(queue.size).toBe(2);
    expect(queue.peek('bm-1')?.payload).toEqual({ v: 3 });
    expect(queue.peek('bm-2')?.payload).toEqual({ v: 2 });
  });

  it('is bounded: evicts the oldest id when the cap is exceeded', () => {
    const queue = new BookmarkEventQueue(3);

    queue.enqueue('created', 'bm-1', {});
    queue.enqueue('created', 'bm-2', {});
    queue.enqueue('created', 'bm-3', {});
    expect(queue.size).toBe(3);

    // Cap reached: a new id evicts the oldest ('bm-1').
    queue.enqueue('created', 'bm-4', {});
    expect(queue.size).toBe(3);
    expect(queue.has('bm-1')).toBe(false);
    expect(queue.has('bm-2')).toBe(true);
    expect(queue.has('bm-4')).toBe(true);

    // Coalescing an existing id must not evict anything.
    queue.enqueue('changed', 'bm-2', { v: 2 });
    expect(queue.size).toBe(3);
    expect(queue.has('bm-3')).toBe(true);
  });

  it('uses the shared default bound', () => {
    const queue = new BookmarkEventQueue();
    for (let i = 0; i < BOOKMARK_EVENT_QUEUE_MAX_SIZE + 10; i++) {
      queue.enqueue('created', `bm-${i}`, {});
    }
    expect(queue.size).toBe(BOOKMARK_EVENT_QUEUE_MAX_SIZE);
    // Oldest entries were evicted.
    expect(queue.has('bm-0')).toBe(false);
    expect(queue.has(`bm-${BOOKMARK_EVENT_QUEUE_MAX_SIZE + 9}`)).toBe(true);
  });

  it('clear() drops everything without processing', () => {
    const queue = new BookmarkEventQueue();
    queue.enqueue('created', 'bm-1', {});
    queue.clear();
    expect(queue.isEmpty).toBe(true);
    expect(queue.drain()).toEqual([]);
  });
});
