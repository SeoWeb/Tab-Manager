# Cloudflare Sync Implementation Plan

This document describes how to add Cloudflare-backed project sync and multi-user collaboration to the Tab Manager extension. The extension remains local-first. Cloudflare is used only as the backend sync layer.

## Target architecture

```txt
Chrome Extension UI
  -> Zustand store
  -> chrome.storage.local
  -> extension sync service
  -> Cloudflare Worker API
  -> Cloudflare D1 database
```

Current relevant extension files:

- `src/stores/appStore.ts:78` persists the Zustand store to `chrome.storage.local`.
- `src/stores/actions/projectActions.ts:29` creates local project data and bookmark folders.
- `src/stores/actions/projectActions.ts:143` already has a manual bookmark sync action.
- `src/lib/sync/projectSync.ts:12` already syncs projects from bookmark folders.
- `public/manifest.json:5-6` currently declares `storage`, `tabs`, `bookmarks`, and `activeTab` permissions.

## Cloudflare stack

Recommended Cloudflare services:

| Service                  | Purpose                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Cloudflare Workers       | Serverless API for sync, auth, projects, members, and invitations                         |
| Cloudflare D1            | SQLite database for projects, collections, links, tasks, notes, members, and sync changes |
| Optional Durable Objects | Realtime presence and per-project live updates                                            |
| Optional R2              | Favicon, screenshot, or other project asset storage                                       |
| Optional Pages           | Web dashboard for account, invites, and project management                                |

Important: the extension should call the Worker API. It should not call D1 directly.

## MVP scope

The first production-ready version should support:

1. User authentication.
2. Project create/read/update/delete.
3. Multi-user project membership.
4. Invite codes.
5. Local-first sync queue.
6. Manual sync button.
7. Background sync using `chrome.alarms`.
8. Conflict handling for concurrent edits.
9. Sync status indicators in the extension UI.

Initial synced entities:

- Projects
- Collections
- Links
- Tasks
- Notes
- Todos

Avoid automatically syncing open browser tabs or bookmark folders unless the user explicitly opts in.

## Backend structure

All backend code should live under `./backend`.

```txt
backend/
  package.json
  tsconfig.json
  wrangler.toml
  deployment.md
  src/
    index.ts
    types.ts
    db/
      migrations/0001_init.sql
    lib/
      auth.ts
      cors.ts
      projects.ts
      members.ts
      sync.ts
      response.ts
```

The Worker entry point is `backend/src/index.ts`.

## Database model

Core tables:

### `users`

Stores authenticated users.

```sql
id
email
display_name
created_at
updated_at
```

### `projects`

Stores project metadata.

```sql
id
name
description
color
icon
owner_id
created_at
updated_at
deleted_at
```

### `project_members`

Stores who can access a project.

```sql
id
project_id
user_id
role
created_at
updated_at
```

Roles:

```txt
owner
admin
editor
viewer
```

### `collections`

Stores collections inside a project.

```sql
id
project_id
name
description
color
minimized
order_index
bookmark_folder_id
created_at
updated_at
deleted_at
```

### `links`

Stores saved links.

```sql
id
project_id
collection_id
url
title
fav_icon_url
notes
tags_json
order_index
bookmark_id
created_at
updated_at
deleted_at
```

### `tasks`, `notes`, `todos`

Store task/note/todo payloads as JSON plus common metadata:

```sql
id
project_id
collection_id
title
payload_json
order_index
created_at
updated_at
deleted_at
```

### `sync_changes`

Append-only change log used by the extension sync protocol.

```sql
id
change_id
project_id
actor_id
entity_type
entity_id
operation
patch_json
base_version
client_mutation_id
client_id
created_at
```

### `entity_versions`

Tracks per-entity version numbers for conflict handling.

```sql
project_id
entity_type
entity_id
version
updated_at
```

### `invitations`

Stores project invite codes.

```sql
id
project_id
code
email
role
created_by
expires_at
accepted_at
created_at
```

## Sync protocol

The extension should keep a local mutation queue in `chrome.storage.local`.

Mutation shape:

```ts
type Mutation = {
  clientMutationId: string;
  projectId: string;
  entityType: 'project' | 'collection' | 'link' | 'task' | 'note' | 'todo';
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  patch: Record<string, unknown>;
  baseVersion?: number;
  clientId: string;
  createdAt: string;
};
```

Sync request:

```ts
POST /projects/:projectId/sync

{
  lastCursor: number | null,
  mutations: Mutation[]
}
```

Sync response:

```ts
{
  cursor: number,
  changes: SyncChange[],
  conflicts: Conflict[]
}
```

Server behavior:

1. Verify the user's JWT.
2. Verify the user has access to the project.
3. Insert each mutation idempotently using `clientMutationId`.
4. Apply mutations inside a D1 transaction.
5. Return accepted changes since `lastCursor`.
6. Extension applies remote changes to the local Zustand store.
7. Extension clears successfully applied local mutations from the queue.

## Conflict strategy

MVP conflict handling:

| Entity/action                       | Strategy                                              |
| ----------------------------------- | ----------------------------------------------------- |
| Project name/description/color/icon | Last-write-wins                                       |
| Collection name/description/color   | Last-write-wins                                       |
| Link add                            | Keep both concurrent adds                             |
| Link update                         | Last-write-wins unless base version conflicts         |
| Link delete                         | Delete wins or return conflict if edited concurrently |
| Reorder                             | Last reorder wins                                     |
| Tasks/notes/todos                   | Last-write-wins                                       |

Better future strategy:

- Use `baseVersion`.
- If `baseVersion` does not match current `entity_versions.version`, return a conflict.
- Extension can either auto-merge or show a conflict UI.

## Extension integration plan

### 1. Add sync state to Zustand

Add fields to `AppState`:

```ts
cloudSync: {
  enabled: boolean;
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict';
  lastSyncedAt: string | null;
  lastError: string | null;
  pendingMutationCount: number;
}
```

### 2. Add a Cloudflare sync client

Create:

```txt
src/lib/cloudflareSync/
  client.ts
  queue.ts
  applyChanges.ts
  pushMutations.ts
  pullChanges.ts
```

Responsibilities:

- Read/write sync queue from `chrome.storage.local`.
- Attach auth token.
- Call `POST /projects/:projectId/sync`.
- Apply remote changes to the Zustand store.
- Update sync status.

### 3. Update project actions

Modify `src/stores/actions/projectActions.ts`:

- If project sync mode is cloud, create local project first.
- Enqueue a `create project` mutation.
- Do not wait for the network request before updating UI.
- Add actions:
  - `convertProjectToCloud`
  - `disconnectProjectFromCloud`
  - `syncProjectNow`

### 4. Update collection/link/task/note/todo actions

Every mutating action should enqueue a mutation when cloud sync is enabled.

Examples:

- `addCollection` -> enqueue collection create
- `updateCollection` -> enqueue collection update
- `addLink` -> enqueue link create
- `updateLink` -> enqueue link update
- `deleteCollection` -> enqueue collection delete

### 5. Add background sync

Use `chrome.alarms`:

```txt
src/background/
  alarms.ts
  messages.ts
```

Trigger sync when:

- Extension opens.
- Browser comes online.
- A sync alarm fires.
- User clicks manual sync.

### 6. Add UI

Add these UI areas:

#### Settings

- Connect account
- Sync status
- Last synced timestamp
- Manual sync button
- Disconnect cloud sync

#### Add Project Modal

- Toggle: `Sync this project to cloud`
- Optional privacy setting

#### Project menu

- Share project
- Invite users
- Members and roles
- Sync now
- Convert local project to cloud project

#### Sync badges

- Synced
- Syncing
- Offline
- Conflict
- Sync failed

## Required manifest updates

Update `public/manifest.json` for the Cloudflare backend.

Add a background service worker:

```json
"background": {
  "service_worker": "background.js"
}
```

Add host permissions for the Worker domain:

```json
"host_permissions": [
  "https://*.workers.dev/*",
  "https://*.tabmanager.example/*"
]
```

Replace the example domain with the deployed Worker domain.

## Cloudflare deployment flow

1. Create D1 database.
2. Run D1 migrations from `backend/src/db/migrations/0001_init.sql`.
3. Create Worker.
4. Bind D1 database to the Worker.
5. Set environment variables.
6. Deploy Worker.
7. Update extension `host_permissions` with the Worker URL.

See `deployment.md` for exact commands.

## Security requirements

1. Never put D1 credentials or Cloudflare secrets in the extension.
2. Extension should only store a user access token.
3. Worker must verify JWTs on every protected route.
4. Worker must check project membership before reading or writing project data.
5. Use role checks:
   - `viewer`: read only
   - `editor`: create/update/delete project entities
   - `admin`: manage members and project metadata
   - `owner`: full control
6. Avoid syncing sensitive browser data unless the user explicitly opts in.
7. Consider end-to-end encryption for project payloads if privacy is a major requirement.

## Phased implementation

### Phase 1: Backend foundation

- Deploy Worker.
- Deploy D1 database.
- Add migrations.
- Add auth middleware.
- Add project CRUD.
- Add membership CRUD.
- Add invite codes.

### Phase 2: Extension sync client — ✅ Implemented

- Add sync state to Zustand.
- Add mutation queue.
- Add Cloudflare API client.
- Add manual sync button.
- Add sync status UI.

Implementation:

- `src/lib/cloudflareSync/` — client (HTTP), mutation queue, auth/config storage,
  remote-change reducer, and orchestrator (`initCloudSync`, `connectCloudAccount`,
  `disconnectCloudAccount`, `syncProjectNow`, `syncAllCloudProjects`,
  `enqueueCloudMutation`).
- `src/stores/actions/cloudSyncActions.ts` — `cloudSync` state slice plus
  `setCloudSyncState`, `setProjectCursor`, `mergeRemoteChanges`.
- `src/components/cloud-sync/` — `CloudSyncSettingsPanel` (connect / status /
  manual sync / sign out), `CloudSyncStatusBadge`, `CloudSyncProvider`.
- `public/manifest.json` — `host_permissions` for the Worker
  (`localhost:8787`, `*.workers.dev`).

Token lives in `chrome.storage.local` (never a secret). Mutations are enqueued
via `enqueueCloudMutation`; Phase 3 wires the entity actions to call it.

### Phase 3: Local-first sync — ✅ Implemented

- Enqueue project mutations.
- Enqueue collection/link mutations.
- Implement pull and apply remote changes.
- Implement idempotent mutation handling.
- Add basic conflict handling.

Implementation:

- `Project.cloudEnabled` (`src/types/index.ts`) is the explicit local/cloud
  distinction. Cloud projects carry the server-assigned id as their local id
  (the Worker mints project ids via `POST /projects` and rejects project
  _create_ on the sync endpoint); entity ids stay client-authoritative.
- `enqueueCloudChange` (`orchestrator.ts`) is the single guarded entry point —
  it enqueues only when sync is enabled and the project is `cloudEnabled`, and
  swallows storage errors so a sync hiccup never blocks the optimistic update.
- Entity actions (`projectActions`, `collectionActions`, `linkActions`,
  `dragDropActions`) enqueue create/update/delete for project, collection, and
  link mutations, plus order syncs for moves/reorders. Internal calls
  (bookmark/favicon backfill) and device-local fields (bookmark ids) are
  excluded. Project updates/deletes go through the sync endpoint; project
  creation goes through `POST /projects`.
- Cloud project lifecycle (`orchestrator.ts`): `addCloudProject` (create +
  local add with server id), `convertProjectToCloud` (re-key an existing local
  project + backfill its collections/links as create mutations),
  `disconnectProjectFromCloud` (stop syncing; server copy kept).
- `syncAllCloudProjects` now targets `cloudEnabled` projects. `syncProjectNow`
  drops conflicted mutations after surfacing them (last-write-wins; prevents
  unbounded queue growth / repeated conflicts). Idempotency rests on the queue
  dedup + the server's `clientMutationId` check. Pull/apply is the Phase 2
  `applyRemoteChanges` reducer, now exercised by the wired mutations.
- UI: Add Project modal "Sync this project to cloud" toggle → `addCloudProject`;
  Project actions menu adds Sync now / Convert to cloud / Disconnect from cloud
  (shown only when sync is connected).

Out of Phase 3 scope (deferred): enqueuing notes/tasks (not project-scoped
locally; pull-side already supported), background `chrome.alarms` sync (Phase 5),
and invite/member UI (Phase 4).

### Phase 4: Multi-user collaboration — ✅ Implemented

- Invite users to projects.
- Enforce roles.
- Add member list UI.
- Add role change UI.
- Add activity log.

Implementation:

- **Backend** (already present from Phase 1, one Phase 4 addition): the
  collaboration routes are all live — `GET/PATCH/DELETE /projects/:id/members`,
  `POST /projects/:id/invitations`, `POST /invitations/:code/accept`,
  `GET /projects/:id/activity` (`backend/src/lib/projects.ts`, wired in
  `backend/src/index.ts`). Role checks are enforced server-side on every route
  (`requireProjectAccess` + minimum-role per action; only owners can remove
  members or transfer the owner role; the owner role is never grantable via
  invite). The Phase 4 addition: `GET /projects/:id` now also returns the
  requesting user's `role` (the membership row was already resolved and
  discarded) so the extension can enforce the role in the UI.
- **Types**: `CloudRole`, `CloudMember`, `CloudInvitation`,
  `CloudAcceptedInvitation`, `CloudProjectDetail`, `CloudActivityResponse` in
  `src/lib/cloudflareSync/types.ts`; `Project.cloudRole` in `src/types/index.ts`.
- **Client** (`client.ts`): `getProject`, `getProjectMembers`,
  `createProjectInvitation`, `acceptProjectInvitation`, `updateMemberRole`,
  `removeProjectMember`, `getProjectActivity`.
- **Orchestrator** (`orchestrator.ts`): `refreshProjectRole`,
  `fetchProjectMembers`, `createProjectInviteCode`, `changeMemberRole`,
  `removeProjectMemberById`, `fetchProjectActivity`, `acceptInviteCode`
  (accept → fetch project + role → materialize locally or re-enable → pull).
  `addCloudProject`/`convertProjectToCloud` set the local role to `owner`;
  `syncProjectNow` refreshes the role best-effort on each successful sync.
- **Role helpers** (`src/lib/cloudflareSync/roles.ts`): `roleAtLeast`,
  `canEdit`, `canManageMembers`, `isOwner`, `CLOUD_ROLES`, `CLOUD_ROLE_RANK`.
  A missing role means local/unknown → full UI control (local-first); only a
  known low role restricts affordances. Backend remains the authorization
  truth — these only decide which controls the UI offers. Covered by a jest
  suite (`__tests__/roles.test.ts`, 15 cases).
- **Store**: `setProjectCloudRole` action + `addProject` option to seed it.
- **UI**:
  - `ProjectCollaborationModal` (cloud projects) with **Members** (list, role
    change, remove, invite-code creation with copy) and **Activity** (recent
    change log, read-only) tabs. Member management is admin-gated and degrades
    to a read-only note on 403; invite roles exclude `owner`; you can never
    change/remove yourself.
  - `CloudSyncInvitesCard` in Settings — paste an invite code to join; on
    success the project is added locally and selected.
  - Project menu adds **Share & members** for cloud projects.
- **Client-side role enforcement**: **Edit/Delete project** (ProjectActionsMenu),
  **Add collection** (AddCollectionButton), and the **per-link edit** action
  (LinkItem) are disabled for viewers on shared cloud projects. The backend
  rejects any unauthorized write regardless.

Out of Phase 4 scope (deferred): realtime member/role updates (Phase 5
Durable Objects), richer conflict resolution UI (Phase 6), and an
audit log distinct from the shared `sync_changes` activity feed.

### Phase 5: Background and realtime — ✅ Implemented

- Add `chrome.alarms`.
- Add sync on online event.
- Add Durable Objects for realtime presence.
- Add live updates for active project edits.

Implementation:

- **Background service worker** (`src/background/index.ts`, bundled to
  `build/background.js`). Registers a `chrome.alarms` cadence (re-armed on
  install + startup) and runs one sync pass on install, on startup, and on each
  alarm. It is DOM-free and does **not** import the React app store.
- **Storage-direct background sync** (`src/lib/cloudflareSync/backgroundSync.ts`)
  reads the persisted Zustand JSON straight from `chrome.storage.local`, pushes
  the queued mutations, pulls remote changes, and writes them back via the same
  pure `applyRemoteChanges` reducer the popup uses — so apply semantics are
  identical without pulling the DOM/store graph into the worker. The store write
  is a read-modify-write against the freshest persisted state, with pulled
  changes filtered by the fresh per-project cursor, so it neither clobbers the
  popup's in-flight local edits nor double-applies changes the popup already got
  over realtime.
- **Coordination lock** (`src/lib/cloudflareSync/syncLock.ts`,
  `cloud-sync-lock` in `chrome.storage.local`) prevents the popup and background
  from concurrently running a full sync (which could double-apply pulled rows).
  Owners are per-context (`'background'` vs `'popup'`); a held-and-fresh
  (<60s) lock makes the other context defer.
- **Online-event sync** (`src/components/cloud-sync/CloudSyncRealtime.tsx`): the
  service worker has no `window`, so the browser `online` event triggers a full
  `syncAllCloudProjects` from the popup/newtab (and reconnects the realtime
  socket). The popup also rehydrates from storage when the background writes a
  newer sync while it is open.
- **Realtime presence + live fan-out (Durable Object)**:
  - `backend/src/lib/realtime.ts` — `ProjectRoom` DO (WebSocket Hibernation
    API), one instance per project (`idFromName`). Members connect over a
    WebSocket; identity (user / display name / role / client) rides as
    hibernation tags so presence is rebuilt faithfully after a wake. A `POST
/notify` fans `{type:'changes', …}` to every connected socket; presence
    snapshots are broadcast on join/leave.
  - Route `GET /projects/:id/realtime` (`backend/src/index.ts`) authenticates
    the `?token=` query param, verifies membership (viewer+), and forwards the
    upgrade to the DO (CORS is bypassed for WS). The DO class is exported from
    the entry module; binding + migration live in `backend/wrangler.toml`.
  - Fan-out wiring: `sync.ts` captures a before-cursor, then broadcasts only the
    rows committed during the request via `notifyRealtime`; `updateProject` and
    `deleteProject` broadcast their change row too. (`createProject` has no
    pre-existing subscriber and is covered on the next pull.)
- **Realtime client** (`src/lib/cloudflareSync/realtime.ts` + pure
  `realtimeMessages.ts`): opens the WebSocket for the active cloud project; on a
  `changes` frame it folds the rows into the live store (`mergeRemoteChanges`)
  and advances the cursor; `presence` updates the roster. Auto-reconnects with
  capped backoff. Auth via `?token=` (WSS encrypts it; MVP choice documented).
- **Store/UI**: `CloudSyncState` gains `realtimeConnected` + `onlinePresence`
  (actions `setRealtimeConnected` / `setOnlinePresence`); the status badge shows
  a live dot and the collaboration modal shows online presence (read-only).
- **Manifest/build**: `alarms` permission + `background.service_worker` (ESM);
  `esbuild` bundles the worker (`scripts/build-background.mjs`, `@/` alias
  resolved via `build.resolve`) as a step in `pnpm run build`.
- **Tests**: extension jest — `backgroundSync` (push/pull/apply write-back,
  cursor advance, queue clear, lock-skip, conflict, disabled),
  `realtimeMessages` (changes apply + no-backward cursor, presence, unknown),
  `syncLock` (acquire/release/steal-stale/isLockedByOther); backend vitest —
  realtime presence helpers (tag round-trip, dedupe, malformed). `pnpm run
build`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run test:backend` all
  pass.

Out of Phase 5 scope (deferred to Phase 6): a richer conflict-resolution UI,
audit logs distinct from the `sync_changes` activity feed, request validation /
rate limiting, end-to-end encryption, and automated browser tests. The realtime
auth is query-param-token (acceptable over WSS for MVP; a subprotocol or
first-message handshake is a future hardening step).

### Phase 6: Privacy and hardening

- Add end-to-end encryption option.
- Add audit logs.
- Add rate limiting.
- Add request validation.
- Add automated tests.
- Add restore/snapshot support.

## Acceptance criteria

The MVP is complete when:

- A user can create a cloud-synced project from the extension.
- The project exists in Cloudflare D1.
- Another user can join the project through an invite.
- Both users can add/edit/delete collections and links.
- Changes sync through the Worker API.
- Offline changes are queued and synced later.
- Duplicate mutations are ignored safely.
- Protected routes reject unauthenticated users.
- Protected project routes reject users without membership.
