# Proposal

## Why

Deleting a link in TabSpace frequently shows an error toast — "Error deleting bookmark: Can't find bookmark for id." — even though the link is (or becomes) correctly deleted. The root cause is that the extension treats `chrome.bookmarks.remove()` rejecting for a non-existent bookmark id as a hard failure. Stale ids arise from four sources: non-idempotent deletion (including the orphan-cleanup path, which always targets an already-vanished bookmark), the cloud-sync pull path re-injecting another device's local bookmark ids, imports preserving foreign bookmark ids, and unsynchronized move/delete operations that can double-remove the same bookmark id.

## What Changes

- Make bookmark mirror deletion **idempotent**: `deleteBookmark()` (and `deleteBookmarkTree()` for consistency) pre-check bookmark existence via the existing `getBookmarkNode` helper (or catch "not found") and treat "already gone" as success — no error toast. The orphan-cleanup path in link sync stops surfacing spurious errors.
- Stop the **cloud sync pull path** from re-injecting device-local `bookmarkId`: pull patches no longer map `bookmarkId`, and the apply path ignores `patch.bookmarkId` (build → `null`, merge → keep the local value), matching the push path which already excludes it. Backend schema/columns unchanged.
- Stop **imports** from carrying foreign `bookmarkId` into state: the import schema keeps the field for backward-compatible parsing, but the mapping into state strips it so full sync re-mirrors from this device's tree. The regression test that currently asserts a foreign id survives import is flipped.
- **Serialize per-link bookmark mirror operations**: link bookmark removals (delete-side mirror cleanup) are routed through the same per-link queue/chain used by `queueLinkBookmarkMirrorMove` so overlapping move/delete operations cannot double-remove the same bookmark id. The store removal stays immediate for UI responsiveness.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `bookmark-mirror-sync`: link deletion becomes idempotent (deleting a link whose mirror bookmark no longer exists succeeds silently); cloud-sync pulls and imports must never overwrite device-local bookmark ids; bookmark mirror move/delete operations for the same link are serialized.

## Impact

- **Affected code (extension only)**: `src/lib/bookmarkService.ts` (idempotent delete), `src/lib/cloudflareSync/reconcileCore/pullPatches.ts` + `src/lib/cloudflareSync/apply/links.ts` (drop `bookmarkId` from pull/apply), `src/lib/importExport/schema.ts` (strip `bookmarkId` on import mapping), `src/lib/linkBookmarkMirror.ts` (per-link queue also covers removal), tests (`bookmarkMirrorRegression.test.ts` assertion flip; new jest tests).
- **No backend changes**: no API, schema, or migration changes — the `bookmark_id` column stays as-is; only the extension stops trusting it on pull/import.
- **No breaking changes** to stored data or sync payloads.
- Tests run via `pnpm test` (jest, extension).
