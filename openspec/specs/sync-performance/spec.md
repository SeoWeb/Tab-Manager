# sync-performance Specification

## Purpose
TBD - created by archiving change scale-sync-backend. Update Purpose after archive.
## Requirements
### Requirement: Bounded round-trips per sync
Applying a sync request SHALL batch independent mutations into shared D1 batch calls such that the number of D1 round-trips grows with the number of *conflict-checked dependency groups*, not linearly with mutation count. A maximum-size sync (200 mutations) SHALL complete within 100 D1 round-trips under normal conditions (no conflicts), excluding quota-guard round-trips.

#### Scenario: Large sync stays within budget
- **WHEN** a sync request carries 200 independent update mutations
- **THEN** the application completes within 100 D1 round-trips and produces identical outcomes to serial application

#### Scenario: Conflicts still detected under batching
- **WHEN** a batched group contains a mutation whose CAS version check fails
- **THEN** that mutation reports a conflict while unrelated mutations in the same sync still apply

### Requirement: Realtime notification off the request path
Realtime fan-out after a successful sync SHALL be scheduled via `ctx.waitUntil` (or equivalent post-response execution) and SHALL NOT be awaited within the request-response path. A slow or failed notification SHALL NOT fail the sync response; failures SHALL be logged.

#### Scenario: Slow DO does not delay the sync response
- **WHEN** the project room DO is slow to accept a notification after a successful sync
- **THEN** the client receives its sync response without waiting for the notification

#### Scenario: Notification failure does not fail the sync
- **WHEN** notification delivery throws
- **THEN** the sync response is unaffected and the failure is logged

### Requirement: Indexed hot-path queries
Queries on the sync hot paths — entity existence/version checks, per-project entity counts, snapshot reads, and member/role lookups — SHALL be index-supported: `project_id` indexes on collections, links, tasks, notes, and todos; an index on `project_members(user_id)`; and an index on `invitations(project_id)`. The entity-quota count SHALL be computed once per sync request (cached), not re-queried per create mutation.

#### Scenario: Member project listing uses the user index
- **WHEN** a user's project list is resolved from `project_members`
- **THEN** the lookup uses the `user_id` index (verified by query plan) rather than a table scan

#### Scenario: Entity quota counted once per sync
- **WHEN** a sync carries 50 create mutations
- **THEN** the entity count is fetched once for the request, not 50 times

### Requirement: Paginated snapshots
`GET /projects/:id/snapshot` SHALL support cursor-based pagination per entity type (bounded page size, default 500 entities per page) while remaining backward-compatible: a request without cursor parameters returns the first page. Clients SHALL be able to iterate to a complete snapshot, and a fully-paginated fetch SHALL produce the same reconcile result as a single unbounded snapshot.

#### Scenario: Large project paginates
- **WHEN** a project contains 5,000 links and the client requests a snapshot
- **THEN** responses contain at most the page cap per call and the client can iterate cursors to retrieve all 5,000

#### Scenario: Paginated reconcile equals full snapshot
- **WHEN** a client reconciles using an iterated paginated snapshot
- **THEN** the resulting local state matches a reconcile from an equivalent unbounded snapshot

### Requirement: Chunked realtime fan-out
Change notifications exceeding a maximum message size SHALL be split into ordered chunks reassembled by clients, and fan-out SHALL prefer non-hibernating sockets. A notification failure for one socket SHALL NOT prevent delivery to other sockets.

#### Scenario: Large notification is chunked
- **WHEN** a sync produces a fan-out payload exceeding the size cap
- **THEN** sockets receive ordered chunks and clients reconstruct the complete notification

#### Scenario: One bad socket does not block others
- **WHEN** delivery to one WebSocket fails during fan-out
- **THEN** the remaining sockets still receive the notification

