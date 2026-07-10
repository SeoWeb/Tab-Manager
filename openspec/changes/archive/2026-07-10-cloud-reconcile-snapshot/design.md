## Context

Cloud sync is currently an incremental, cursor-based replay of the server's append-only change log. `POST /projects/:id/sync` pushes queued mutations and pulls `sync_changes` rows with `id > cursor` (`backend/src/lib/sync.ts:219`). Local state is rebuilt purely by replaying those rows via `applyRemoteChanges` (`src/lib/cloudflareSync/applyChanges.ts`).

Two structural properties make this unable to self-heal:

1. **Forward-only cursor.** Once the cursor passes a `create`/`delete` row, that row is never re-fetched. There is no endpoint returning current entity state, and `GET /projects/:id` returns only project metadata/role.
2. **Dropped applies are permanent.** `applyRemoteChanges` returns `false` (counted "skipped") when it cannot materialize a change — a `collection` create needs the project local (`applyChanges.ts:211`), a `link` create needs its parent collection local (`applyChanges.ts:298`). The cursor still advances, so the entity is unreachable forever.

Result: a connected project whose `create` (or `delete`) row was ever missed stays permanently divergent, even though the server still holds the undeleted data. The user wants an automatic, periodic full reconciliation against current server truth with last-write-wins repair.

## Goals / Non-Goals

**Goals:**
- Provide a server "snapshot" of a project's current entities (including soft-deleted) for diffing.
- Implement a pure, testable `diffSnapshot(local, server)` that classifies every entity.
- Apply the diff locally (pulls via the existing reducer; pushes via the existing mutation queue).
- Run reconciliation periodically (every 30 min) and on startup / offline→online when stale.
- Preserve in-flight local edits through existing field-level conflict detection.

**Non-Goals:**
- No change to the incremental cursor-pull path (it stays the hot path for real-time co-editing).
- No hard deletes on the server; the snapshot always exposes `deleted_at` so local deletes are repairable.
- No schema migration (reads existing tables only).
- No UI for manually triggering reconcile in this change (the existing "Sync now" + automatic cadence suffice); surfacing is limited to status/conflict UI reuse.

## Decisions

**D1. Snapshot endpoint returns current + soft-deleted entities.**
`GET /projects/:id/snapshot` returns `collections`, `links`, `tasks`, `notes`, `todos` with `id, project_id, collection_id, updated_at, deleted_at, version` (+ type-specific fields). It includes rows with `deleted_at IS NOT NULL` so reconciliation can delete them locally. *Alternative considered:* only return live rows and infer deletes from absence. Rejected — absence cannot distinguish "deleted remotely" from "never existed remotely," and the user's rule requires deleting locally only when the server has explicitly marked deletion.
Each row LEFT JOINs `entity_versions` for `version` to break `updated_at` ties precisely.

**D2. Reconcile reuses `applyRemoteChanges` for pulls.**
`diffSnapshot` emits synthetic `CloudSyncChange[]` rows (`create`/`update`/`delete`) tagged `client_id: null` so the existing reducer never skips them as own echoes (`applyChanges.ts:89`). This reuses all nesting (project→collection→link) and field-level conflict logic for free. *Alternative:* hand-written store mutations. Rejected — duplicates and drifts from the proven reducer.

**D3. Pushes reuse the existing mutation queue.**
Local-newer / local-only entities are enqueued via `enqueueCloudChange` using centralized patch builders (see D5). The next incremental sync pushes them. No new write path.

**D4. Two reconcile entry points share the pure diff.**
- `reconcileProject` (store-aware, in `orchestrator.ts`) for the popup/web React context.
- `backgroundReconcileAll` (store-free, in `backgroundSync.ts`) for the extension service worker — mirrors `backgroundSyncAll`'s read-persisted-JSON → diff → `applyRemoteChanges` → write-back pattern, and enqueues pushes via `queue.enqueueMutation`.
Both call the same `diffSnapshot`, keeping behavior identical and testable.

**D5. Centralize patch builders.**
Move `collectionCreatePatch`/`linkCreatePatch` out of `orchestrator.ts:102` and add `buildLinkPatch` into `entityPatches.ts` (alongside the existing `buildNotePatch`/`buildTodoPatch`/`buildTaskPatch`). Used by both `convertProjectToCloud` and reconcile pushes.

**D6. `updatedAt` added to `Link`.**
Collections/tasks/notes/todos already have `updatedAt`; links only have `createdAt`. Add `updatedAt: Date` to the `Link` interface (`src/types/index.ts`) and set it on create/update (`linkActions.ts`) and preserve it in `applyChanges.ts` (`buildLink`/`mergeLink`). Required for link LWW comparison. **Backfill:** local links already persisted in storage predate this field and would have `updatedAt === undefined`, which breaks LWW (`undefined > date` is always false). Add a one-time migration defaulting `updatedAt = createdAt` (or have `diffSnapshot` treat a missing `updatedAt` as `createdAt`). Without this, legacy links silently lose every comparison.

**D7. Cadence & triggers.**
- Extension: add alarm `cloud-reconcile` at `periodInMinutes: 30` in `src/background/index.ts`; also trigger on `onInstalled`/`onStartup` and on offline→online when `>30 min` since `lastReconciledAt`.
- Web: a 30-min `setInterval` in `frontend/src/components/AppClient.tsx` plus `online`/`visibilitychange` triggers when stale.
- Track `lastReconciledAt` in the `cloudSync` state (and persisted), gated by `isOnline()` and the sync lock. **Reconcile MUST NOT advance `lastSyncedAt`** — that timestamp is the incremental cursor's heartbeat and is used to detect sync staleness; conflating the two would mask a broken incremental path.

**D8. Role guard on pushes.**
Viewers (role < editor) cannot push (server enforces this in `syncProject`). Reconcile only enqueues pushes when `cloudRole` ≥ editor; viewers still pull/delete locally.

**D9. Queue guard also applies to create/update-locally pulls.**
The "skip if a mutation is already queued for that entity" rule is not push-only. If a local delete (or edit) is still queued and unsynced, the snapshot still shows the entity as live, so a naive `create-locally` would resurrect an item the user just deleted. Reconcile must therefore treat an entity with a pending local mutation as locally authoritative and skip the pull classification for it (the queued mutation will reconcile on the next incremental sync). This is a transient flap, not a correctness hole, but the guard removes it entirely.

## Risks / Trade-offs

- **[Resurrection of locally-deleted items]** If a local item has no server row at all, reconcile pushes a create (per the user's "newer wins" rule). This can re-create an item another device deleted *if that delete change was missed and the server row is hard-absent*. → Mitigation: server items are only ever **marked** deleted (`deleted_at`), so the snapshot still contains them and reconcile deletes locally instead of resurrecting. The only resurrection case is a truly absent server row, which the rule explicitly treats as "new local item → push."
- **[Large snapshot payload]** A project with many entities returns all current rows. → Acceptable for typical sizes; `updated_at`/`version` keep comparison cheap. Pagination can be added later keyed by entity type if needed.
- **[Pull-side resurrection of a queued local delete]** A user deletes an item locally (mutation queued, not yet synced); before the delete reaches the server, reconcile fetches a snapshot that still shows the entity live and, seeing it absent locally, classifies it `create-locally` — briefly resurrecting it. → Mitigation (D9): reconcile treats any entity with a pending local mutation as locally authoritative and skips the pull; the queued mutation reconciles on the next incremental sync, so no flap occurs.
- **[Clobbering pending local edits]** Pushes of local-newer entities that are mid-edit. → `diffSnapshot`/`applyRemoteChanges` reuse `detectConflicts` to skip fields with queued (pending) edits; those surface as `SyncConflictItem`s in the existing `SyncConflictsPanel`.

## Migration Plan

- Backend: additive route + handler; no migration. Deploy Worker independently.
- Extension/web: additive code; existing sync continues to work. Rollback = remove the reconcile alarm/interval and `reconcile.ts` (no data loss; incremental sync remains the source of truth until reconcile runs).
- No user-facing setting required; reconciliation is automatic and invisible except via sync status/conflict badges.

## Open Questions

- None blocking. Pagination of the snapshot is deferred (see Risks).
