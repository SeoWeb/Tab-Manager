## ADDED Requirements

### Requirement: Project-scoped entity access
Every entity read, write, and delete performed by the sync engine SHALL be scoped to the project of the API route. Entity-existence checks, version reads, row reads, updates, and deletes MUST filter on both the entity `id` and the route's `project_id`. An update mutation whose target entity does not exist in the route's project SHALL be treated as a conflict (or reported as skipped per the error contract), never as an update to a foreign entity. An update MUST NOT change an entity's `project_id`.

#### Scenario: Update a foreign entity is rejected
- **WHEN** an editor of project A submits an update mutation whose entity `id` belongs to project B
- **THEN** no row in project B is modified and the mutation is reported as conflicted/skipped

#### Scenario: Delete a foreign entity is rejected
- **WHEN** a delete mutation targets an entity `id` that exists in a different project than the route
- **THEN** the foreign entity is not tombstoned and the mutation is reported as conflicted/skipped

#### Scenario: Update cannot move entities across projects
- **WHEN** any update mutation is applied
- **THEN** the entity's `project_id` remains unchanged

#### Scenario: Version reads are project-scoped
- **WHEN** a version is fetched to evaluate conflict detection for a mutation
- **THEN** the fetched version belongs to an entity in the route's project; a foreign or nonexistent entity yields no usable version and the mutation is rejected

### Requirement: Updates require a base version
Update mutations MUST include `baseVersion`. A mutation without `baseVersion` SHALL be rejected as a bad request rather than applied without conflict detection, so version checking cannot be bypassed by omission.

#### Scenario: Missing baseVersion is rejected
- **WHEN** an update mutation is submitted without `baseVersion`
- **THEN** the mutation is not applied and the response reports it as a bad mutation

#### Scenario: Stale baseVersion conflicts
- **WHEN** an update mutation's `baseVersion` does not match the entity's current version
- **THEN** the mutation returns a conflict and the entity is unchanged

### Requirement: Changelog rows belong to the entity's project
Change-log rows and version bumps for an entity mutation SHALL be written to the entity's owning project only. A mutation MUST NOT cause members of the submitting user's project to receive fan-out for an entity that project does not own.

#### Scenario: Foreign-entity mutation produces no cross-project fan-out
- **WHEN** a mutation referencing a foreign entity is rejected
- **THEN** no change-log row is written to the submitter's project and other members receive nothing

### Requirement: Realtime access follows membership
When a member is removed from a project or their role changes, the system SHALL close (or re-authorize) their open realtime connections for that project room immediately. Presence roles SHALL be re-derived from current membership, not cached from connect time.

#### Scenario: Removed member's socket is closed
- **WHEN** an owner removes a member who currently has an open project-room WebSocket
- **THEN** that socket is closed by the server and the ex-member receives no further change fan-out for the project

#### Scenario: Role downgrade applies to live sessions
- **WHEN** a member's role changes from editor to viewer while connected
- **THEN** subsequent fan-out treats them as viewer and editor-only messages are not delivered to them as editor
