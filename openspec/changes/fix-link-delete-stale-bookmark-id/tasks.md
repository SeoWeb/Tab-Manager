# Tasks

Ordering: Group 1 is the foundation (idempotent delete underpins every delete path). Groups 2–4 are independent of each other and can run in parallel once Group 1 lands. Group 5 is integration verification only.

## 1. Idempotent bookmark deletion (foundation)

- [x] 1.1 Make `deleteBookmark()` in `src/lib/bookmarkService.ts` idempotent: pre-check the bookmark with the existing `getBookmarkNode(id)` helper and return success when it is `null`; when the node exists, call `chrome.bookmarks.remove(id)` and treat a not-found rejection ("Can't find bookmark…" / "not found") as success, letting any other error propagate to the existing toast path. Verify with a new jest test file `src/lib/__tests__/cases/idempotentBookmarkDeletion.test.ts` covering: (a) missing id resolves without error, (b) existing id still calls `chrome.bookmarks.remove`, (c) `remove` rejecting with not-found after the pre-check resolves successfully, (d) `remove` rejecting with an unrelated error still propagates. Run: `pnpm test -- idempotentBookmarkDeletion`
- [x] 1.2 Apply the same pre-check + catch-not-found idempotency to `deleteBookmarkTree()` in `src/lib/bookmarkService.ts` so deleting an already-absent tree root succeeds silently. Extend `src/lib/__tests__/cases/idempotentBookmarkDeletion.test.ts` with a scenario for an already-gone root and one for an existing root. Run: `pnpm test -- idempotentBookmarkDeletion`
- [x] 1.3 Verify no error toast is surfaced when deleting a link whose bookmark is gone: extend `src/lib/__tests__/cases/idempotentBookmarkDeletion.test.ts` (or the deleteLink action test setup) to drive the link delete path (`src/stores/actions/linkActions.ts` `deleteLink` → `src/lib/bookmarkStorage.ts` `deleteLink`) with a missing bookmark id and assert `showErrorToast` is not invoked; also exercise the orphan-cleanup path from `src/lib/sync/linkSync.ts` (`deleteLink` for a link whose bookmark vanished). Run: `pnpm test -- idempotentBookmarkDeletion`

## 2. Cloud sync pull/apply ignores device-local bookmarkId

- [x] 2.1 Stop mapping `bookmarkId` in the pull patch: remove `bookmarkId: row.bookmark_id` from `src/lib/cloudflareSync/reconcileCore/pullPatches.ts`. Verify `pnpm run typecheck` passes.
- [x] 2.2 Make the apply path ignore `patch.bookmarkId` in `src/lib/cloudflareSync/apply/links.ts`: `buildLink` sets `bookmarkId` to `null`; `mergeLink` keeps the local `link.bookmarkId ?? null` regardless of the patch. Verify with a new jest test file `src/lib/__tests__/cases/cloudPullBookmarkId.test.ts` covering: (a) a pulled patch for an existing local link leaves the local bookmark id unchanged, (b) a pulled patch creating a link yields `bookmarkId` `null`. Run: `pnpm test -- cloudPullBookmarkId`

## 3. Import strips foreign bookmarkId

- [x] 3.1 Keep `bookmarkId` in the import schema in `src/lib/importExport/schema.ts` for backward-compatible parsing, but strip it when mapping parsed imports into state so imported links start unmirrored. Flip the assertion in `src/lib/__tests__/cases/bookmarkMirrorRegression.test.ts` (~line 415): a foreign `bm-x` bookmark id must NOT survive import. Run: `pnpm test -- bookmarkMirrorRegression`
  - Implemented via `src/lib/importExport/merge.ts` (all 4 state-mapping sites strip `bookmarkId`) + `src/lib/__tests__/cases/importStripsBookmarkId.test.ts`. Deviation note: the referenced `bookmarkMirrorRegression.test.ts` ~line 415 assertion exercises the local-sync mirror pipeline (`LinkSync.createLinkFromBookmark`), where `bm-x` is a genuinely local id — the assertion is correct and was left intact. The foreign-id-stripping intent is covered by the new import-path tests.
- [x] 3.2 Add a jest test asserting an export containing `bookmarkId` still parses cleanly (schema backward compat) but the resulting state has no bookmark id, in `src/lib/__tests__/cases/bookmarkMirrorRegression.test.ts` or a new `src/lib/__tests__/cases/importStripsBookmarkId.test.ts`. Run: `pnpm test -- bookmarkMirrorRegression importStripsBookmarkId`

## 4. Serialize per-link mirror move/delete operations

- [x] 4.1 Extend the per-link queue/chain in `src/lib/linkBookmarkMirror.ts` (the mechanism behind `queueLinkBookmarkMirrorMove`) so mirror removals — the delete-side cleanup reachable from `src/stores/actions/linkActions.ts` `deleteLink` → `src/lib/bookmarkStorage.ts` `deleteLink` → `bookmarkService.deleteBookmark`, including the move-path compensation delete — are submitted to the same per-link chain instead of running concurrently. The store-level link removal stays immediate. Verify with a new jest test file `src/lib/__tests__/cases/linkMirrorSerialization.test.ts` covering: (a) an overlapping move + delete for the same link results in at most one `chrome.bookmarks.remove` for that bookmark id, (b) the store removal is not delayed behind a queued mirror operation. Run: `pnpm test -- linkMirrorSerialization`

## 5. Integration verification (no new tests)

- [x] 5.1 Run the full project gates and fix any fallout from Groups 1–4: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`. All must pass.
- [x] 5.2 Confirm the change is complete and valid: `openspec validate fix-link-delete-stale-bookmark-id` passes and `openspec status --change fix-link-delete-stale-bookmark-id` shows all artifacts complete.
