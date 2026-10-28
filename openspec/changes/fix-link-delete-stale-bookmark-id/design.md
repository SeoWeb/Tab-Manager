# Design

## Context

See proposal.md — Why. The extension surfaces "Error deleting bookmark: Can't find bookmark for id." when `chrome.bookmarks.remove(id)` rejects because the id is absent from the local bookmark tree. Four independent sources of stale ids converge on that rejection:

1. `deleteBookmark()` in `src/lib/bookmarkService.ts` (~lines 140–158) calls `chrome.bookmarks.remove(id)` unconditionally; the only upstream guard is truthiness of `linkToDelete.bookmarkId` in `src/stores/actions/linkActions.ts` (`deleteLink`, ~lines 231–284, guard at ~261). The orphan-cleanup path in `src/lib/sync/linkSync.ts` (~lines 34–45) deletes links whose bookmark vanished (fire-and-forget at ~line 42) — this path *always* targets a missing bookmark and therefore always triggers the doomed remove and the error toast. A helper `getBookmarkNode()` (~lines 189–205) already exists and returns `null` for missing ids.
2. The push path excludes `bookmarkId` (device-local; comment in `src/lib/cloudflareSync/entityPatches.ts` `buildLinkPatch`, ~lines 44–62), but the pull path re-injects it: `src/lib/cloudflareSync/reconcileCore/pullPatches.ts` (~line 30) maps `bookmarkId: row.bookmark_id`, applied in `src/lib/cloudflareSync/apply/links.ts` via `buildLink` (~line 97) and `mergeLink` (~line 120) through `pickString([patch.bookmarkId])`.
3. `src/lib/importExport/schema.ts` (~line 31) keeps `bookmarkId` optional in the import schema and the import mapping carries it into state; `bookmarkMirrorRegression.test.ts` (~line 415) currently asserts a foreign id (`bm-x`) *survives* import.
4. Cross-collection moves remove the old bookmark (`src/lib/linkBookmarkMirror.ts` ~line 101, compensation delete ~line 106) and `deleteLink` mirror removal (`linkActions.ts` ~line 264 → `src/lib/bookmarkStorage.ts` `deleteLink` ~lines 199–201 → `bookmarkService.deleteBookmark`) are unsynchronized, so overlapping operations can double-remove the same id.

Related context: the archived change `openspec/changes/archive/2026-10-22-fix-cross-context-data-loss/` made *folder* deletion non-destructive; this change extends the same spirit of tolerance to *link* deletion. Error surfacing goes through `src/lib/toast.ts` (`showErrorToast`).

## Goals / Non-Goals

**Goals:**

- Deleting a link (or a mirrored tree) whose bookmark is already gone succeeds silently — no toast.
- Foreign device bookmark ids never enter this device's state via cloud pull or import.
- Move and delete mirror operations on the same link cannot interleave into a double-remove.
- All behavior verified by jest tests runnable via `pnpm test`.

**Non-Goals:**

- No backend/API/schema changes: the `bookmark_id` column stays; only the extension stops trusting it on pull/import.
- No change to push-path payload shape (it already excludes `bookmarkId`).
- No repair/re-adoption logic for stale ids beyond silent success (folder-level restore flows from the archived change remain untouched).
- No UI changes beyond the removal of the spurious error toast.

## Decisions

### D1 — Idempotent delete: pre-check via `getBookmarkNode`, catch "not found" as a safety net

`deleteBookmark()` first resolves the node with the existing `getBookmarkNode(id)` helper (which returns `null` for missing ids). If `null`, return success immediately (no Chrome call, no toast). If the node exists, call `chrome.bookmarks.remove(id)`; if the call still rejects with a not-found error (a race between the check and the remove), treat that rejection as success too.

- *Why both?* The pre-check avoids relying on error-message matching against a Chrome-internal string (brittle across Chrome versions and locales), while the catch keeps the operation correct under a check-then-remove race — e.g. the user (or another extension surface) deletes the bookmark between the two steps.
- *Alternative considered:* catch-only (wrap `remove` and swallow not-found). Rejected as primary approach because it requires string-matching the rejection message; kept only as the race safety net with a deliberately loose match (message contains "Can't find bookmark" / "not found", or the Chrome `runtime.lastError` shape), and any *other* error still propagates to the existing toast path.
- Apply the same pre-check + catch pattern to `deleteBookmarkTree()` for consistency, so tree deletion of an already-removed root also succeeds silently.

### D2 — Pull/apply ignore `bookmarkId`; backend column stays

Remove the `bookmarkId: row.bookmark_id` mapping from `pullPatches.ts`. In `apply/links.ts`: `buildLink` sets `bookmarkId` to `null` (a created link has no device-local mirror yet); `mergeLink` ignores `patch.bookmarkId` entirely and keeps the local `link.bookmarkId ?? null`. The backend `bookmark_id` column and payloads are unchanged — we simply stop reading it on this path, mirroring the push path which already stops writing it.

- *Why keep the column?* Dropping it is a backend migration with no consumer benefit; other/possible future consumers (e.g. diagnostics) are unaffected, and no sync payload shape changes, so old/new extension versions interoperate.
- *Alternative considered:* keep mapping but tag ids with a device id and compare on apply. Rejected: new schema concept, more moving parts, and the push path's existing "device-local, never synced" convention already establishes the right semantics — bookmark ids are simply not syncable data.

### D3 — Import keeps schema field for parsing, strips it when mapping into state

`schema.ts` keeps `bookmarkId` in the import schema (older exports still parse cleanly — backward compatible). The mapping step that turns parsed imports into state drops `bookmarkId`, so imported links start unmirrored and full bookmark sync re-mirrors them from this device's tree. Flip the `bookmarkMirrorRegression.test.ts` assertion (~line 415): a foreign `bm-x` id must NOT survive import.

- *Alternative considered:* remove the field from the schema entirely. Rejected: `.optional()` fields absent from old files parse fine, but a field *present* in an export would fail strict parsing or be silently rejected depending on the configured mode; keeping the field and stripping at the mapping boundary is strictly more tolerant.
- *Alternative considered:* keep imported ids and reconcile them against the local tree before first use. Rejected: pointless work — imported ids almost certainly belong to another device's tree, and reconciling them re-introduces the stale-id class this change eliminates.

### D4 — Route delete-side mirror removal through the existing per-link queue

`linkBookmarkMirror.ts` already serializes per-link mirror work via the queue/chain behind `queueLinkBookmarkMirrorMove`. Extend that mechanism so mirror *removals* (the delete side: `linkActions.ts` → `bookmarkStorage.deleteLink` → `bookmarkService.deleteBookmark`) are submitted to the same per-link chain instead of running concurrently. The store-level link removal stays immediate (UI responsiveness is unaffected); only the bookmark-tree side of the deletion is queued. The compensation delete inside the move path (~line 106) also flows through the chain so it cannot race a queued removal.

- *Why reuse the existing queue?* It already solves exactly this problem for moves (same key: the link), is tested, and keeps one ordering authority per link.
- *Alternative considered:* a mutex/lock keyed by bookmark id around every `chrome.bookmarks.remove` call. Rejected: a second synchronization primitive invites the same interleaving bugs one level down and duplicates what the per-link queue already provides.
- *Alternative considered:* make the store removal await the queued mirror work. Rejected: deletions would visibly lag whenever a move is in flight; spec requires the UI removal to stay immediate.

## Task ordering dependency

The idempotent-delete work (Work Item 1) is the **foundation**: it changes `bookmarkService.deleteBookmark`/`deleteBookmarkTree`, which every other item calls into. Work Items 2 (pull/apply bookmarkId), 3 (import stripping), and 4 (per-link serialization) are **independent of each other** and can proceed in parallel once Item 1 lands.

## Risks / Trade-offs

- [Error-message matching in the catch path may not cover every Chrome phrasing] → The pre-check handles the common case without matching; the catch is a best-effort safety net and unknown errors still surface via the existing toast path.
- [Pre-check + remove is not atomic] → Acceptable: the catch path treats not-found as success, so the only cost of losing the race is a skipped remove of an already-absent bookmark.
- [Swallowing not-found could mask genuine misconfiguration, e.g. wrong root folder id] → The silent-success path is limited to "bookmark for this id does not exist"; other remove failures (quota, permission) still propagate. The orphan-cleanup path already *knows* the bookmark is gone before deleting, so nothing is masked there.
- [Ignoring `patch.bookmarkId` on merge leaves local ids pointing at bookmarks that were deleted on the device that owned them] → Out of scope by design: folder-level absence already resolves to "unmapped" per the archived change, and link-level absence now resolves to silent idempotent success (D1). No data loss either way.
- [Stripping imported bookmark ids delays mirroring until the next sync] → Same behavior as links created before mirroring runs; full sync re-mirrors them, which is the established flow for unmapped links.
- [Serializing removals behind moves adds latency to the bookmark side of a delete] → Bounded by one pending move per link; the store removal is immediate, so the user never waits.
