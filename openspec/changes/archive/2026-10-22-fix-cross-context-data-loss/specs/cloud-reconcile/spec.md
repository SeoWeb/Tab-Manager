## ADDED Requirements

### Requirement: Sync lock is held across store writes and self-renews
A sync (incremental or background reconcile) SHALL hold the advisory sync lock from before it reads local state until after it has finished writing pulled changes to the store. The lock SHALL renew itself (heartbeat) while the sync runs so long-running syncs are not stolen, and all sync HTTP requests SHALL carry a timeout so a hung request cannot hold (or outlive) the lock indefinitely. On timeout, the sync SHALL release the lock and report failure without applying partial pulls.

#### Scenario: Background pull cannot be interleaved with a popup sync
- **WHEN** the background reconcile writes pulled changes and a popup "Sync now" starts concurrently
- **THEN** the popup sync waits for the lock until the background pull's store write completes (or vice versa) — never reads state inside the other's read-modify-write window

#### Scenario: Long sync renews its lock
- **WHEN** a sync with a large payload runs longer than the lock's freshness window
- **THEN** its heartbeat renews the lock and no second context starts a concurrent sync

#### Scenario: Hung request cannot wedge the lock
- **WHEN** a sync HTTP request exceeds the request timeout
- **THEN** the request is aborted, the sync releases the lock, and the next sync can acquire it

### Requirement: Conflicted mutations are retained until resolution applies
When a queued mutation produces a conflict, the queue SHALL retain it (marked as conflicted) until the user's resolution has actually been applied — locally and, where chosen, pushed to the server. Conflicted mutations MUST NOT be deleted from the queue merely because a conflict was recorded. Conflict resolution SHALL be supported for all syncable entity types (task, note, todo, collection, link): resolving to the local value pushes a local patch; resolving to the remote value applies the remote version locally; both paths then release the queued mutation.

#### Scenario: Conflict does not silently drop the local edit
- **WHEN** a pushed note update conflicts and the user does not yet resolve it
- **THEN** the queued mutation remains in the queue marked conflicted and the local edit remains visible in the UI

#### Scenario: Resolve-to-local pushes for every entity type
- **WHEN** the user resolves a conflict on a link (or collection/todo) as "keep mine"
- **THEN** a patch built from the local value is enqueued/pushed and the queued mutation is released

#### Scenario: Resolve-to-remote applies for every entity type
- **WHEN** the user resolves a todo conflict as "take theirs"
- **THEN** the remote version replaces the local entity and the queued mutation is released
