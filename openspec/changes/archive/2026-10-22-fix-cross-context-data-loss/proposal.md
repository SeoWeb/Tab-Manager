## Why

The popup, every open newtab, and the background service worker each hold a full in-memory copy of the app state and persist the entire blob to one `chrome.storage.local` key with last-writer-wins semantics — and nothing refreshes a context when another context writes. Ordinary usage (popup while a newtab is open) silently loses edits; rehydration replaces arrays wholesale and reverts in-flight edits; the background sync releases its lock before writing the store; every context runs its own tab auto-saver against the same key; the bookmark mirror drops events, fakes its mutex with a 100 ms timeout, deletes local projects when bookmark folders vanish, and matches entities by display name. Separately, a persistence quirk forces `hasCompletedOnboarding: true` after the first store write, so genuinely new users can never complete the wizard.

## What Changes

- Add a persisted `stateGeneration` counter: every context checks it before writing and re-merges instead of overwriting on mismatch; all contexts subscribe to `chrome.storage.onChanged` and rehydrate with an id- and `updatedAt`-aware merge (no wholesale array replacement).
- Hold the advisory sync lock across the store write in the background sync path (matching the popup path); add a fetch timeout and a lock heartbeat so hung requests can't strand or lose the lock.
- Move tab-session auto-save and session-restore checks into the background service worker only; page contexts send messages instead of writing storage.
- Rework bookmark mirroring: queue (don't drop) events during sync; replace the `setTimeout` suppressor with try/finally; real trailing-edge debounce; match folders by `bookmarkFolderId` only (never by name); vanished folders soft-delete to trash instead of destroying local projects/collections; fix the `.bind()` listener-removal leak.
- Onboarding: completion is tracked solely by the explicit `hasCompletedOnboarding` flag; the "persisted projects array implies completed" inference is replaced by a one-time migration marker so upgrading users are skipped exactly once and new users can complete the wizard.
- Hardening: `partialize` errors skip the write instead of persisting `{}`; conflicted sync mutations stay queued until their resolution is actually applied; conflict resolution (`applyResolution`/`pushResolvedValue`) supports link, collection, and todo — not just task/note; stable default IDs in mock data; hydration gating actually awaits hydration.

## Capabilities

### New Capabilities
- `cross-context-state-sync`: Consistency guarantees for the multiple contexts (popup, newtabs, background) that share one `chrome.storage.local` state blob — generation-checked writes, change-notification rehydration with merge-not-replace semantics, single-owner tab auto-save, and persistence-failure safety.
- `bookmark-mirror-sync`: Reliable mirroring between TabSpace projects/collections and the Chrome bookmark tree — event queueing, ID-based entity matching, non-destructive handling of deleted folders, and correct listener lifecycle.

### Modified Capabilities
- `first-run-onboarding`: First-run detection no longer infers completion from the presence of a persisted `projects` array; an explicit flag plus a one-time upgrade marker governs when the wizard shows.
- `cloud-reconcile`: The advisory sync lock must be held across store writes and self-renew; conflicted mutations are retained (not deleted) until their resolution applies, and conflict resolution covers all entity types.

## Impact

- **Modified files**: `src/stores/appStore.ts` (generation check, `partialize` safety, persist wiring), `src/stores/storage.ts` (generation read/write, `onChanged` subscription), `src/stores/mergeAppState.ts` (merge-by-id), `src/stores/storeWrapper.tsx` (real hydration gate), `src/stores/mockData.ts` (stable IDs), `src/lib/cloudflareSync/backgroundSync.ts` + `orchestrator/sync.ts` (lock scope, cursor timing), `src/lib/cloudflareSync/syncLock.ts` (heartbeat), `src/lib/cloudflareSync/client.ts` (AbortController timeout), `src/lib/cloudflareSync/queue.ts` (conflict retention), `src/stores/actions/cloudSyncActions.ts` (resolution for all entity types), `src/components/AppClient.tsx` + `src/lib/tabSessionService/autoSave.ts` (background-only auto-save), `src/lib/sync/syncHandlers.ts`, `src/lib/bookmarkStorage.ts`, `src/lib/bookmarkSyncService.ts`, `src/lib/sync/projectSync.ts`, `src/lib/sync/collectionSync.ts` (queue, ID matching, trash), `src/components/AppClient.tsx` (onboarding trigger), `src/background/index.ts` (auto-save owner, message handlers).
- **Storage schema**: persisted blob gains `stateGeneration`; new `tab-manager-onboarding-migration` marker key; `current_tab_session` writes move to the background worker (readers unchanged).
- **No server changes**; cloud sync protocol untouched.
