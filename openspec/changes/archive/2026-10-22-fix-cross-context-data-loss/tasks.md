## 1. Storage Wrapper: Generation-Checked Writes

- [x] 1.1 In `src/stores/storage.ts`, add `stateGeneration` to the persisted blob schema; implement read/observe helpers tracking the context's last-seen generation
- [x] 1.2 Wrap `setItem`: re-read stored generation; on mismatch, merge pending snapshot with stored blob (via 1.3) before writing; always write `generation + 1`; on write-skew error, retry once after merge
- [x] 1.3 Extend `src/stores/mergeAppState.ts`: per-entity-type union by `id` with `updatedAt` compare (ties → persisted), never removing local-only entities; add pure-function unit tests for create/update/delete interleavings
- [x] 1.4 Subscribe to `chrome.storage.onChanged` per context; debounce 500 ms (trailing) and rehydrate through the merge path; ignore self-echo events by generation
- [x] 1.5 Keep `CloudSyncRealtime` for cloud cursors only; remove its wholesale state replacement path
- [x] 1.6 Add a two-context storage simulator in `src/stores/__tests__/storageSimulator.ts` (atomic get/set + `onChanged`) and tests: popup+newtab interleaved edits both survive; background pull doesn't revert in-flight popup edits

## 2. Persistence & Hydration Safety

- [x] 2.1 In `appStore.ts` `partialize`, replace the `{}` fallback with skip-the-write (log + metric); add test that a throwing partialize leaves stored data intact
- [x] 2.2 Add structural validation + quarantine (copy-aside key) for invalid stored snapshots on load; test corrupt blob → quarantined, app boots with defaults, no silent wipe
- [x] 2.3 Fix `storeWrapper.tsx` to gate children on the real async hydration signal; delete the dead `checkStore` logic
- [x] 2.4 Make `mockData.ts` default state deterministic (fixed IDs via constants); test two fresh contexts produce identical default IDs
- [x] 2.5 Remove the selector-swallowing wrappers (`useSafeAppStore`, `useAppStoreWithDefaults` try/catch) and fix any selector that relied on them; add per-region error boundaries with a Reset action (see cleanup change for a11y wiring)

## 3. Sync Lock Scope, Timeout, Heartbeat

- [x] 3.1 In `backgroundSync.ts`, hold the lock across `applyToStore`/`applyReconcileToStore` (mirror `orchestrator/sync.ts`); move `syncProjectNow`'s cursor read inside the acquired lock
- [x] 3.2 Add `AbortController` with 30 s timeout to all `client.ts` fetches; on abort, release the lock and surface a retryable error
- [x] 3.3 Implement lock heartbeat via `chrome.alarms` (30 s) refreshing the lock timestamp while held; clear on release and on worker boot (stale-lock recovery already exists)
- [x] 3.4 Test: simulated long sync renews lock and blocks a concurrent popup sync; aborted fetch releases the lock

## 4. Background-Only Tab Auto-Save

- [x] 4.1 Guard `autoSave.ts` so only the service worker registers tab listeners + the periodic save; page contexts send `{type:'save-tab-session'}` via `chrome.runtime.sendMessage`
- [x] 4.2 Add the message handler in `src/background/index.ts` (top-level, try/catch per existing conventions); move session-restore eligibility check to the worker
- [x] 4.3 Update `AppClient.tsx` to stop starting auto-save per page; test: two page contexts + worker ⇒ exactly one listener set and one write path

## 5. Bookmark Mirror Rework

- [x] 5.1 Create `BookmarkEventQueue` (Map by bookmark id → latest event, bounded, coalescing); `syncHandlers.ts` enqueues during in-progress sync and drains after completion
- [x] 5.2 Replace `setTimeout` suppression in `bookmarkStorage.ts` with try/finally flag management around every extension-initiated bookmark write; test failure path restores the flag
- [x] 5.3 Make `performPartialSync` a real trailing debounce (1 s) so N events ⇒ one sync; test with 20 rapid events
- [x] 5.4 Remove all name-based folder→entity matching in `projectSync.ts`, `collectionSync.ts`, and `uiActions.ts`; unreferenced folders are ignored/reported, never adopted
- [x] 5.5 On missing mirrored folder: clear `bookmarkFolderId`, set display-only `mirrorRemoved` flag (no deletion of local entities); add "re-link" flow in the project/collection UI; folder re-appearance restores mapping
- [x] 5.6 Fix `bookmarkSyncService.destroy()` listener removal (store bound references); test teardown ⇒ single handling after re-create
- [x] 5.7 Delete the stale-snapshot deletion logic in `projectSync.ts`/`collectionSync.ts` (read fresh state after awaits)

## 6. Onboarding Fix

- [x] 6.1 Change `mergeAppState.ts` to govern `hasCompletedOnboarding` solely by the explicit persisted flag; delete the `Array.isArray(projects)` inference
- [x] 6.2 Add the `onboardingMigrationDone` marker write-once logic in `AppClient` mount (upgrading users: set marker, skip wizard; fresh installs: no marker → wizard until completed)
- [x] 6.3 Update `AppClient.tsx` trigger to match the spec (open on hydrate when flag false and marker logic resolved); keep Settings replay untouched
- [x] 6.4 Tests: fresh install shows wizard; first store write doesn't complete onboarding; dismissal without completing re-shows next launch; upgrading user (pre-marker storage) skipped exactly once

## 7. Conflict Retention & Resolution Coverage

- [x] 7.1 In `queue.ts`, keep conflicted mutations flagged (`conflicted`) instead of deleting; release only on applied resolution or explicit user discard; expose conflicted count in sync status UI
- [x] 7.2 Extend `cloudSyncActions.ts` `applyResolution`/`pushResolvedValue` to collection, link, and todo (patch builders per type, mirroring task/note); test resolve-to-local and resolve-to-remote for every entity type
- [x] 7.3 Test end-to-end: conflict recorded → local edit still visible → resolution applies → mutation released and pushed
