## Why

The current cloud sync is an incremental, cursor-based replay of the server's append-only change log (`POST /projects/:id/sync` → `getChangesSince`). Once a `create` (or `delete`) change row scrolls past the local cursor, or is dropped because its parent entity wasn't local yet, the local store can permanently diverge from the server: collections/links/tasks/notes/todos that still exist (undeleted) on the server never get restored, and missed deletions never get applied locally. There is no mechanism that verifies the local state actually matches the server's *current* entity set. We need a periodic, full reconciliation that diffs local state against current server truth and repairs divergences with last-write-wins.

## What Changes

- Add a new backend endpoint `GET /projects/:id/snapshot` that returns the project's **current** entities (collections, links, tasks, notes, todos) — including soft-deleted ones — with `updated_at`, `deleted_at`, and `version`.
- Add a pure client-side `diffSnapshot(local, server)` that classifies every entity into: create-locally, update-locally, delete-locally, or push-to-server.
- Add `reconcileProject` / `reconcileAllCloudProjects` (store-aware) and `backgroundReconcileAll` (store-free, service-worker safe) that run the diff and apply it.
- Reconcile pulls are fed through the existing `applyRemoteChanges` reducer (reusing field-level conflict detection so pending unsynced edits are preserved); pushes are enqueued as normal cloud mutations.
- Wire reconciliation on a 30-minute cadence (extension alarm + web interval), and trigger it on startup / when crossing offline→online if more than 30 minutes have elapsed since the last reconcile.
- Add `updatedAt` to the `Link` type so links can participate in last-write-wins comparison (collections/tasks/notes/todos already carry it). Backfill `updatedAt = createdAt` for links already persisted locally so legacy rows don't compare as `undefined`.

### Reconcile rules (last-write-wins by `updated_at`, ties broken by `version`)

- Server has it (not deleted), local missing → **create locally**.
- Server has it (not deleted), local has it → **newer `updated_at` wins**; update the older side (push if local newer, apply if server newer).
- Server has it marked deleted (`deleted_at` set), local has it → **delete locally** (server deletion is authoritative).
- Local has it, server has no row at all → **push create to server** (new local item). Guards: only for `cloudEnabled` projects, only if role ≥ editor (viewers are pull-only), skip if a mutation is already queued for that entity.
- Pull classifications (create/update/delete-locally) are also skipped for any entity that has a **pending local mutation**: a queued-but-unsynced local delete/edit would otherwise be resurrected by a snapshot that still shows the entity as live. The queued mutation reconciles on the next incremental sync instead.

## Capabilities

### New Capabilities
- `cloud-reconcile`: Periodic full reconciliation of local cloud-project state against the server's current entity set (snapshot diff + last-write-wins repair) for projects, collections, links, tasks, notes, and todos. Covers the snapshot endpoint, the diff engine, and the cadence wiring for both the extension service worker and the web app.

### Modified Capabilities
<!-- No existing specs cover cloud sync reconciliation; this is a new capability. -->

## Impact

- **Backend**: new `GET /projects/:id/snapshot` route + `getProjectSnapshot` handler in `backend/src/index.ts` and `backend/src/lib/projects.ts`; new `SnapshotResponse` type in `backend/src/types.ts`. Reads existing tables only — **no schema migration** required.
- **Extension client**: new `src/lib/cloudflareSync/reconcile.ts`, additions to `client.ts` and `types.ts`, `updatedAt` added to `Link` (`src/types/index.ts`), patch builders centralized in `entityPatches.ts`, `reconcileProject`/`reconcileAllCloudProjects` in `orchestrator.ts`.
- **Background sync**: `backgroundReconcileAll` added to `src/lib/cloudflareSync/backgroundSync.ts`; new `cloud-reconcile` alarm in `src/background/index.ts`.
- **Web app**: slower reconcile interval + online/visibility triggers in `frontend/src/components/AppClient.tsx`.
- **Conflict surfacing**: reuses existing `SyncConflictsPanel` via `applyRemoteChanges`' conflict detection.
- **Tests**: backend snapshot tests, pure `diffSnapshot` unit tests, and a reconcile integration test.
