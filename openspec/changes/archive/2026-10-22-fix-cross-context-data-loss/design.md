## Context

Three kinds of contexts run the same Next.js app simultaneously: the toolbar popup (short-lived), any number of open newtabs (long-lived), and the MV3 service worker (each writes via `backgroundSync`). All persist the full `AppState` through the Zustand persist middleware to `chrome.storage.local['tab-manager-storage']`. `chrome.storage` has no transactions, no compare-and-swap, and `onChanged` events carry only the new value — the design must build consistency from a generation counter plus id-aware merges. The advisory sync lock (`syncLock.ts`) is a storage key with a 60-second freshness check and, per its own comment, cannot be a true mutex.

Constraints:
- No server-side changes allowed in this phase (backend hardening is a separate change).
- The cloud-sync queue and reconcile engine (`queue.ts`, `reconcile.ts`) are sound and must not be rewritten — the lock scope, conflict retention, and resolution coverage fixes slot around them.
- Zustand persist middleware controls serialization; generation checks must hook its flow (e.g. custom storage wrapper) rather than fight it.
- jest + jsdom is the only extension test harness (chrome APIs are mocked); tests must simulate multi-context interleavings against one mocked `chrome.storage`.

## Goals / Non-Goals

**Goals:**
- No silent data loss in normal local-only usage (the default mode).
- Deterministic onboarding behavior matching the spec's intent.
- Bookmark mirroring that never destroys user data and never mislinks entities.
- All fixes testable in jest with a two-context storage simulator.

**Non-Goals:**
- Moving state to `chrome.storage.sync`, IndexedDB, or splitting the blob per-project (a larger architecture change deliberately deferred).
- CRDT/operational-transform merging — last-write-wins at field/entity grain with `updatedAt` remains the conflict model.
- Server-side fixes (concurrent cloud syncs from two machines still rely on backend conflict detection, hardened separately).
- Reworking Quick Clips or drag-and-drop behavior beyond the entity-matching fixes they share with bookmark sync.

## Decisions

- **Generation counter in the storage wrapper, not the store.** A custom `chromeStorageApi` wrapper around the persist middleware: on `setItem`, re-read the stored blob's `stateGeneration`; if it differs from the generation this context last observed, run the pending snapshot through `mergeAppState`-style merging against the stored blob *before* writing, then write with `generation + 1`. The store's `set()` path stays synchronous and unchanged — the wrapper is the single choke point every context already uses. *Alternative:* broadcast channel asking contexts to rehydrate before every write — adds async latency to every keystroke-adjacent persist and deadlocks if a context is suspended; the wrapper approach keeps writes cheap and optimistic.
- **Merge = per-entity-type union by `id` with `updatedAt` compare.** Extend `mergeAppState`: for each entity list (projects, collections, links, notes, todos, tasks), index persisted entries by id; union with local entries; for ids in both, take the newer `updatedAt` (ties → persisted, matching LWW); never drop local-only entries. Deletions remain the known LWW gap (a delete in one context can be resurrected by a stale snapshot in the other) — accepted for this phase; the queued-entity guard from reconcile covers cloud-synced deletes. *Alternative:* vector clocks per entity — real CRDT work, rejected as out of scope.
- **`onChanged` rehydrate, debounced per context (e.g. 500 ms trailing)**, replacing the `CloudSyncRealtime` timestamp-only trigger (which stays for cloud cursors). Rehydrate uses the same merge path, so it converges regardless of which context wrote. Guard against echo: ignore events whose new generation equals the context's own last write.
- **Lock scope fix is mechanical:** move `applyToStore`/`applyReconcileToStore` inside the background path's lock window (mirror `orchestrator/sync.ts`); add `AbortController` with 30 s timeout in `client.ts`; heartbeat = `chrome.alarms` every 30 s refreshing the lock timestamp while held, cleared on release. *Alternative:* single global sync owner (all syncs routed through the background worker) — architecturally cleaner but a bigger migration; deferred, noted as follow-up.
- **Auto-save moves to the background worker.** `autoSave.ts` gains a "worker mode" guard (only the SW context registers listeners/interval); page contexts call `chrome.runtime.sendMessage({type:'save-tab-session'})`. The worker already exists and is alive whenever Chrome runs; sessions are not UI-critical, so a suspended worker between events is acceptable (alarms re-arm on boot, as today). *Alternative:* keep per-context savers with a lock — more moving parts for no benefit.
- **Bookmark sync: event queue + try/finally + ID matching.** A small `BookmarkEventQueue` (Map keyed by bookmark id → latest event, drained post-sync); suppression flag wraps every extension-initiated bookmark write in try/finally; `performPartialSync` becomes a real trailing debounce (1 s); matching drops all `p.name === folder.title` fallbacks — unreferenced folders are surfaced in the mirror status UI instead; vanished folders clear `bookmarkFolderId` and mark the project `mirrorRemoved` (new display-only flag), with a one-click "re-link" flow reusing the existing folder-picker. *Alternative:* tombstoning deleted folders as real soft-delete entities — heavier storage model; the flag approach preserves data without new entity types.
- **Onboarding via explicit flag + `onboardingMigrationDone` marker key.** Merge logic: `hasCompletedOnboarding = persisted.hasCompletedOnboarding === true`; upgrading detection runs once in `AppClient` mount: if the marker is absent → set it and (only if storage predated this feature — detected by the marker's absence with existing non-empty state) leave the flag false-y while *not* showing the wizard for that session. Fresh installs (no marker, empty storage) show the wizard until completed/skipped. *Alternative:* store a schema version number and treat pre-onboarding versions as completed — equivalent outcome; the single marker key is simpler.

## Risks / Trade-offs

- [Merge-on-write adds latency to persists under contention] → Only when the generation moved (rare); happy path unchanged. Worst case is one extra read + merge of a large blob — acceptable vs. silent loss.
- [`updatedAt`-based merge can resurrect a just-deleted entity in another context] → Accepted LWW gap, documented; cloud-synced deletes are protected by the existing queued-entity guard; a delete-tombstone model is a follow-up.
- [`onChanged` rehydrate fights an in-progress drag or modal] → Merge preserves local-newer fields; drag operations don't mutate persisted entities mid-drag (drop commits atomically).
- [Background-only auto-save misses the final snapshot on browser quit if the worker was suspended] → Same exposure as today (worker can be suspended either way); alarms + boot-time capture on next start mitigate; popup/newtab still *trigger* saves via message for their own close path.
- [Removing name-based folder adoption breaks workflows that relied on auto-adopting renamed folders] → The re-link UI replaces it explicitly; release notes call it out.
- [Two-context jest simulator can drift from real chrome.storage semantics] → Simulator models the three observable behaviors that matter (atomic key get/set, `onChanged` firehose, no transactions); documented as the contract.

## Migration Plan

1. Land storage wrapper + generation + merge (with feature flag-free rollout; behavior change is immediate but strictly safer).
2. Land lock scope + timeout + heartbeat.
3. Move auto-save ownership; keep message fallback no-op for one release if the worker is unavailable.
4. Land bookmark sync rework (queue/debounce/ID-matching/trash) behind nothing — current behavior is the bug.
5. Onboarding fix last (needs the migration marker logic + jest coverage).

Rollback: each step is independently revertible; no storage schema change is destructive (generation and marker keys are additive; old versions ignore them).

## Open Questions

- Should the mirror-removed flag expose a "delete local too" bulk action in the UI, or only per-project? (Default: per-project; bulk if user feedback asks.)
- Debounce windows: 500 ms rehydrate / 1 s bookmark sync / 30 s lock heartbeat — confirm against real-world timing after instrumentation.
