## ADDED Requirements

### Requirement: Server snapshot of current project entities
The system SHALL provide a `GET /projects/:id/snapshot` endpoint that returns the current entities (collections, links, tasks, notes, todos) for a project the requesting user can access, including soft-deleted entities.

Each returned entity SHALL include `id`, `project_id`, `updated_at`, `deleted_at`, and `version`, plus type-specific fields needed to reconstruct or compare it (e.g. `collection_id`, `url`, `title`, `payload_json`, `order_index`, `tags_json`, `color`, `minimized`, `bookmark_folder_id`, `bookmark_id`).

#### Scenario: Authorized member fetches snapshot
- **WHEN** an authenticated user who is a member (viewer or above) of project `:id` requests `GET /projects/:id/snapshot`
- **THEN** the system returns `collections`, `links`, `tasks`, `notes`, and `todos` arrays for that project, each entity carrying `updated_at`, `deleted_at`, and `version`

#### Scenario: Soft-deleted entities are included
- **WHEN** a collection was soft-deleted on the server (`deleted_at` is set)
- **THEN** it is still present in the snapshot with a non-null `deleted_at` value

#### Scenario: Non-member is denied
- **WHEN** an authenticated user who is not a member of project `:id` requests the snapshot
- **THEN** the system returns a 403/404 authorization error

### Requirement: Local-vs-server diff classification
The system SHALL provide a pure `diffSnapshot(local, server)` function that classifies every entity of type project, collection, link, task, note, and todo into one of: create-locally, update-locally, delete-locally, or push-to-server.

Classification rules SHALL be:
- Server present (not deleted), local missing → create-locally
- Server present (not deleted), local present → update-locally if server `updated_at` (ties broken by `version`) is newer; otherwise push-to-server
- Server present and marked deleted, local present → delete-locally
- Local present, server has no row → push-to-server

#### Scenario: Missing local collection is created locally
- **WHEN** the server snapshot contains a collection the local store lacks
- **THEN** `diffSnapshot` classifies it as create-locally

#### Scenario: Newer server link updates local
- **WHEN** a link exists locally and on the server, and the server `updated_at` is newer
- **THEN** `diffSnapshot` classifies it as update-locally

#### Scenario: Server-deleted entity is removed locally
- **WHEN** a collection is marked deleted on the server but still present locally
- **THEN** `diffSnapshot` classifies it as delete-locally

#### Scenario: Local-only item is pushed
- **WHEN** an entity exists locally but has no corresponding server row
- **THEN** `diffSnapshot` classifies it as push-to-server

### Requirement: Apply reconciliation pulls
The system SHALL apply `create-locally`, `update-locally`, and `delete-locally` classifications by feeding synthetic change rows through the existing `applyRemoteChanges` reducer, so nesting (project→collection→link) and field-level conflict detection are preserved.

Synthetic pull changes SHALL be tagged with `client_id: null` so they are never skipped as own echoes.

A pull classification (create-locally, update-locally, delete-locally) SHALL be skipped when a local mutation for that same entity is already queued and unsynced; the queued mutation reconciles on the next incremental sync instead of being resurrected by a stale snapshot.

#### Scenario: Pull applies without clobbering in-flight edits
- **WHEN** a remote update would overwrite a field the local client has a pending, not-yet-pushed edit for
- **THEN** the local value for that field is retained and a conflict is recorded rather than overwritten

#### Scenario: Queued local delete is not resurrected
- **WHEN** an entity was deleted locally and its delete mutation is still queued, but the snapshot still shows it as live because the delete has not reached the server
- **THEN** reconcile skips the create-locally classification and leaves the deletion pending

### Requirement: Apply reconciliation pushes
The system SHALL apply `push-to-server` classifications by enqueuing normal cloud mutations (via `enqueueCloudChange`) using centralized patch builders, so the next incremental sync transmits them.

Pushes SHALL be skipped when:
- the project is not `cloudEnabled`
- the user's `cloudRole` is below `editor` (viewer is pull-only)
- a mutation for that entity is already queued

#### Scenario: Editor pushes local-only note
- **WHEN** a note exists locally, has no server row, the project is `cloudEnabled`, and the user is an editor
- **THEN** a create mutation for that note is enqueued

#### Scenario: Viewer does not push
- **WHEN** a local-only entity would be pushed but the user's role is `viewer`
- **THEN** no mutation is enqueued and the local entity is left unchanged

### Requirement: Periodic and event-driven reconciliation
The system SHALL run full reconciliation automatically at least every 30 minutes for each cloud-enabled project, and SHALL also run it on startup and when the connection returns online if more than 30 minutes have elapsed since the last reconcile.

#### Scenario: Scheduled reconcile runs
- **WHEN** 30 minutes have passed since the last reconcile
- **THEN** reconciliation runs for all cloud-enabled (or queued) projects

#### Scenario: Startup triggers stale reconcile
- **WHEN** the extension starts (or the tab becomes visible / comes online) and the last reconcile was more than 30 minutes ago
- **THEN** reconciliation runs immediately

#### Scenario: Concurrent guard
- **WHEN** reconciliation and the incremental sync would run at the same time
- **THEN** the advisory sync lock prevents them from running concurrently

### Requirement: Links carry updatedAt
The `Link` entity SHALL include an `updatedAt` field, set on creation and update, and preserved when applying remote changes, so links can be compared for last-write-wins. Links already persisted locally without this field SHALL be backfilled with `updatedAt = createdAt` (via a one-time migration or by treating a missing `updatedAt` as `createdAt` in the diff), so legacy rows are not treated as always-older.

#### Scenario: Link updatedAt preserved on remote apply
- **WHEN** a remote link change is applied locally
- **THEN** the resulting local link has its `updatedAt` set from the server `updated_at`

#### Scenario: Legacy link backfilled
- **WHEN** a link persisted before the `updatedAt` field existed is loaded
- **THEN** it has a usable `updatedAt` (defaulted to its `createdAt`) so LWW comparison does not treat it as `undefined`
