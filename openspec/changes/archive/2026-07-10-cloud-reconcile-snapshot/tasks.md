## 1. Backend snapshot endpoint

- [x] 1.1 Add `SnapshotResponse` (and per-entity snapshot shapes) to `backend/src/types.ts`
- [x] 1.2 Implement `getProjectSnapshot(env, projectId)` in `backend/src/lib/projects.ts` returning collections, links, tasks, notes, todos (including soft-deleted rows), each with `updated_at`, `deleted_at`, and `version` (LEFT JOIN `entity_versions`)
- [x] 1.3 Register `GET /projects/:id/snapshot` route in `backend/src/index.ts` with `requireUser` + `requireProjectAccess` (viewer+), and add it to the listed endpoints
- [x] 1.4 Add backend tests `backend/src/lib/__tests__/snapshot.test.ts` (returns soft-deleted rows, denies non-members, viewer can read)

## 2. Client types & API client

- [x] 2.1 Add `updatedAt: Date` to the `Link` interface in `src/types/index.ts`
- [x] 2.2 Add snapshot response/entity types to `src/lib/cloudflareSync/types.ts`
- [x] 2.3 Add `getProjectSnapshot(projectId)` to `src/lib/cloudflareSync/client.ts`

## 3. Link updatedAt plumbing

- [x] 3.1 Set `updatedAt` when links are created/updated in `src/stores/actions/linkActions.ts` (and any move/drag paths)
- [x] 3.2 Preserve `updatedAt` in `applyChanges.ts` `buildLink`/`mergeLink` (map server `updated_at` → `Date`)
- [x] 3.3 Backfill `updatedAt = createdAt` for links already persisted locally (one-time migration, or treat missing `updatedAt` as `createdAt` in `diffSnapshot`) so legacy rows compare correctly instead of as `undefined`

## 4. Centralize patch builders

- [x] 4.1 Move `collectionCreatePatch`/`linkCreatePatch` out of `orchestrator.ts:102` into `src/lib/cloudflareSync/entityPatches.ts` and export `buildLinkPatch` alongside `buildNotePatch`/`buildTodoPatch`/`buildTaskPatch`
- [x] 4.2 Update `convertProjectToCloud` (`orchestrator.ts:437`) to use the centralized builders

## 5. Reconcile diff engine

- [x] 5.1 Create `src/lib/cloudflareSync/reconcile.ts` with pure `diffSnapshot(local, server)` classifying each entity (create/update/delete-locally, push-to-server) per the spec rules
- [x] 5.2 Emit synthetic `CloudSyncChange[]` pulls tagged `client_id: null`; collect `pushItems` for enqueue
- [x] 5.3 Skip pull classification (create/update/delete-locally) for any entity with a pending queued local mutation (D9), so queued local deletes/edits are not resurrected by a stale snapshot
- [x] 5.4 Add unit tests for `diffSnapshot` (all six entity types; missing/newer/older/deleted/local-only; link nesting; queued-mutation skip; legacy link `updatedAt` backfill)

## 6. Store-aware reconcile orchestration

- [x] 6.1 Add `reconcileProject(projectId)` to `orchestrator.ts`: guard `cloudEnabled`+online+lock, fetch snapshot, run `diffSnapshot`, apply pulls via `applyRemoteChanges`, enqueue pushes via `enqueueCloudChange` (role/queue guards), write back via `useAppStore.setState`, update `lastReconciledAt` only (do NOT advance `lastSyncedAt` — that is the incremental cursor's heartbeat)
- [x] 6.2 Add `reconcileAllCloudProjects()` mirroring `syncAllCloudProjects` (`orchestrator.ts:335`)
- [x] 6.3 Add `lastReconciledAt` to `CloudSyncState` (`types.ts`) and persist it (config/authStorage)

## 7. Background (store-free) reconcile

- [x] 7.1 Add `backgroundReconcileAll()` to `src/lib/cloudflareSync/backgroundSync.ts`: read persisted JSON, loop cloud-enabled projects, fetch snapshot, run `diffSnapshot`, apply pulls via `applyRemoteChanges`, enqueue pushes via `queue.enqueueMutation`, write back (mirror `backgroundSyncAll`)
- [x] 7.2 Export `backgroundReconcileAll` from `src/lib/cloudflareSync/index.ts`

## 8. Cadence wiring

- [x] 8.1 Extension: add `cloud-reconcile` alarm (30 min) + `onInstalled`/`onStartup` + offline→online trigger (gated by `lastReconciledAt` > 30 min) in `src/background/index.ts`
- [x] 8.2 Web: add 30-min reconcile `setInterval` + `online`/`visibilitychange` triggers in `frontend/src/components/AppClient.tsx`

## 9. Conflict surfacing & verification

- [x] 9.1 Reuse `applyRemoteChanges` conflict detection; populate `SyncConflictItem[]` and surface count via existing `SyncConflictsPanel` (status `'conflict'`)
- [x] 9.2 Add a reconcile integration test (snapshot diff → local repair) extending `backend/src/lib/__tests__/sync.test.ts` or a new test
- [x] 9.3 Run typecheck/lint and the new tests to verify the change
