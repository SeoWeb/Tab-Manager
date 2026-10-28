// src/lib/linkBookmarkMirror.ts

import { bookmarkStorage } from './bookmarkStorage';

/**
 * Sequenced bookmark mirroring for link moves and removals.
 *
 * Moving a link between collections mirrors the change in the Chrome bookmark
 * tree (create in the target folder, delete the previous bookmark) and commits
 * the new `bookmarkId` to the store. That commit is state-linked: a stored
 * `bookmarkId` must only be recorded once the bookmark tree actually reflects
 * it. This module owns the whole write → commit sequence so the store never
 * has to fire-and-forget the writes (the previous implementation ran detached
 * inside the state updater, which left `bookmarkId` pointing at a bookmark
 * that had not moved whenever a write failed, and let concurrent moves
 * interleave their create/delete for the same link).
 *
 * Deleting a link mirrors the removal of its bookmark through the same
 * per-link chain (`queueLinkBookmarkRemoval`, called from
 * `linkActions.deleteLink`), so an overlapping move + delete for one link
 * cannot both remove the same bookmark id. The store-level link removal
 * stays immediate — only the bookmark-tree side of the deletion is queued.
 *
 * Guarantees:
 * - Per-link serialization: mirror ops (moves and removals) for the same
 *   link run strictly one after another, in submission order. Ops for
 *   different links are independent and may run in parallel.
 * - Late binding: each op resolves the link's CURRENT bookmark id when it
 *   reaches the front of its chain (an earlier op in the chain may have
 *   already replaced the mirror), so it never acts on a stale id.
 * - Commit-on-success-only: `commitBookmarkId` runs only after the create in
 *   the target folder AND the delete of the previous bookmark both succeeded.
 *   If the delete fails after a successful create, the fresh bookmark is
 *   deleted again (compensation) so no duplicate is orphaned. A failed move
 *   therefore always leaves the pre-op mapping in place — the old bookmark
 *   still exists and still mirrors the link, so the stored `bookmarkId` never
 *   refers to the wrong (or a nonexistent) bookmark.
 * - Bounded retry: a failed move is retried once after a short delay to ride
 *   out transient Chrome API errors; exhausting the retry keeps the pre-op
 *   mapping and reports the error.
 */

/** A link's mirror-relevant fields, resolved at execution time. */
export interface LinkMirrorSnapshot {
  /** The bookmark id currently recorded on the link. */
  oldBookmarkId: string;
  title: string;
  url: string;
}

export interface LinkBookmarkMirrorRequest {
  /** Stable per-link key: mirror ops for one link are strictly serialized. */
  linkId: string;
  /** Destination collection folder for the mirrored bookmark. */
  targetFolderId: string;
  /**
   * Resolve the link's current mirror snapshot when the op reaches the front
   * of its chain. Returning null (the link or its bookmark mapping is gone —
   * e.g. the link was deleted while queued) skips the op without writing
   * anything.
   */
  resolveMirror: () => LinkMirrorSnapshot | null;
  /**
   * Commit the new bookmark id to the store. Invoked ONLY after the mirrored
   * bookmark exists in the target folder AND the previous bookmark was
   * deleted, so a stored `bookmarkId` always refers to the real mirror.
   */
  commitBookmarkId: (newBookmarkId: string) => void;
  /** Delay between attempts. 0 keeps retries on the microtask queue (tests). */
  retryDelayMs?: number;
}

export interface LinkBookmarkRemovalRequest {
  /** Stable per-link key: mirror ops for one link are strictly serialized. */
  linkId: string;
  /**
   * Resolve the bookmark id to remove when the op reaches the front of its
   * chain. Returning null (nothing mirrored) skips the op without writing
   * anything. The delete-side caller resolves the id captured at submission
   * time: the store row is already gone when the op runs, so the captured id
   * is the authoritative mirror to remove.
   */
  resolveBookmarkId: () => string | null;
}

const MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

/**
 * Tail of each link's mirror chain. The next op queued for a link awaits this,
 * which serializes mirror writes per link (unserialized concurrent moves can
 * otherwise create two bookmarks and both delete the same old one, orphaning
 * a bookmark and racing their `bookmarkId` commits).
 */
const chains = new Map<string, Promise<void>>();

/** Test-only override of the default inter-attempt delay. */
let retryDelayOverrideMs: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One mirror-move attempt: create the bookmark in the target folder, delete
 * the previous one, and only then commit the new id.
 */
async function runMirrorMoveAttempt(
  request: LinkBookmarkMirrorRequest
): Promise<void> {
  const snapshot = request.resolveMirror();
  if (!snapshot) return; // mirror mapping vanished while queued: nothing to do

  const created = await bookmarkStorage.createLink(
    snapshot.title,
    snapshot.url,
    request.targetFolderId
  );
  try {
    await bookmarkStorage.deleteLink(snapshot.oldBookmarkId);
  } catch (error) {
    // Compensation: the move did not complete, so do not leave the freshly
    // created bookmark behind as an orphan duplicate of `oldBookmarkId`.
    // This runs INLINE inside the current chain op — re-enqueueing a chain
    // op for the same link from within a running one would wait on the
    // chain tail and deadlock.
    try {
      await bookmarkStorage.deleteLink(created.id);
    } catch {
      // Best-effort only; the primary failure is reported by the caller.
    }
    throw error;
  }
  request.commitBookmarkId(created.id);
}

async function runMirrorMoveWithRetry(
  request: LinkBookmarkMirrorRequest
): Promise<void> {
  const retryDelayMs =
    request.retryDelayMs ?? retryDelayOverrideMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await runMirrorMoveAttempt(request);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }
  // All attempts failed. Keep the pre-op mapping: the previous bookmark was
  // never deleted (its accidental replacement was compensated away), so it
  // still exists and still mirrors this link — the stored `bookmarkId` refers
  // to the right bookmark and only the folder relocation is pending. Committing
  // the new id here would leave state pointing at a bookmark that does not
  // exist.
  console.error(
    `[linkBookmarkMirror] Failed to move the bookmark mirror for link ${request.linkId} after ${MAX_ATTEMPTS} attempts; keeping the existing bookmarkId.`,
    lastError
  );
}

/**
 * One mirror-removal op: delete the bookmark the link maps to. A removal
 * whose target was already deleted by an earlier op in the same chain (the
 * delete-old step of an overlapping move) settles as idempotent success —
 * `bookmarkStorage.deleteLink` treats an absent bookmark as already
 * removed — so the same id is never removed twice.
 */
async function runMirrorRemoval(
  request: LinkBookmarkRemovalRequest
): Promise<void> {
  const bookmarkId = request.resolveBookmarkId();
  if (!bookmarkId) return; // nothing mirrored: nothing to remove
  await bookmarkStorage.deleteLink(bookmarkId);
}

/**
 * Append an op to a link's mirror chain. Moves AND removals share the same
 * chain, so a removal queued while a move for the same link is still in
 * flight runs after that move instead of racing it to delete the same
 * bookmark id. The returned promise settles when this op — and every op
 * queued before it for the same link — has settled; it never rejects
 * (failures are reported inside the chain).
 */
function enqueueLinkMirrorOp(
  linkId: string,
  run: () => Promise<void>
): Promise<void> {
  const previous = chains.get(linkId) ?? Promise.resolve();
  const tail = previous.then(run).catch((error) => {
    // Ops report their own failures; this guard only keeps an unexpected
    // crash from poisoning the rest of the chain or surfacing as an
    // unhandled rejection.
    console.error('[linkBookmarkMirror] Unexpected mirror failure:', error);
  });
  chains.set(linkId, tail);
  void tail.then(() => {
    // Drop the chain once the tail settles so the map does not grow without
    // bound; a concurrently queued op has by then replaced the entry.
    if (chains.get(linkId) === tail) {
      chains.delete(linkId);
    }
  });
  return tail;
}

/**
 * Queue a bookmark-mirror move for a link. See {@link enqueueLinkMirrorOp}
 * for the serialization contract.
 */
export function queueLinkBookmarkMove(
  request: LinkBookmarkMirrorRequest
): Promise<void> {
  return enqueueLinkMirrorOp(request.linkId, () =>
    runMirrorMoveWithRetry(request)
  );
}

/**
 * Queue a bookmark-mirror removal for a link (the delete-side mirror cleanup
 * of `linkActions.deleteLink`). Shares the move chain — see
 * {@link enqueueLinkMirrorOp} — so it can never run concurrently with (and
 * double-remove the target of) an in-flight move for the same link.
 */
export function queueLinkBookmarkRemoval(
  request: LinkBookmarkRemovalRequest
): Promise<void> {
  return enqueueLinkMirrorOp(request.linkId, () => runMirrorRemoval(request));
}

/**
 * Awaits every queued mirror op, including their retries. Test hook: lets
 * store-level tests observe the post-mirror state without reaching into the
 * chain map.
 */
export function flushLinkBookmarkMirrorsForTests(): Promise<void> {
  return Promise.all(Array.from(chains.values())).then(() => undefined);
}

/** Clears all chains and retry-delay overrides between tests. */
export function resetLinkBookmarkMirrorForTests(): void {
  chains.clear();
  retryDelayOverrideMs = null;
}

/**
 * Overrides the default inter-attempt delay (used by store-level tests, which
 * drive the mirroring through `moveLink` and therefore cannot pass
 * `retryDelayMs` per request).
 */
export function setLinkBookmarkMirrorRetryDelayForTests(ms: number): void {
  retryDelayOverrideMs = ms;
}
