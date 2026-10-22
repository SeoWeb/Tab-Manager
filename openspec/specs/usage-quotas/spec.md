## Purpose

Bound resource consumption per user, project, and request so no tenant can exhaust the backend: caps on projects, project members, entities per project, and sync request size, each enforced atomically and configurable via environment variables.
## Requirements
### Requirement: Maximum projects per user
The system SHALL enforce a maximum number of active (non-deleted) projects owned by a user. The default maximum is 10 and SHALL be overridable via `QUOTA_MAX_PROJECTS_PER_USER`. The count check and the project creation SHALL occur within a single transaction so that concurrent requests cannot both observe available capacity and overshoot the maximum.

#### Scenario: Create within quota
- **WHEN** a user with fewer than the maximum active projects creates a project
- **THEN** the project is created normally

#### Scenario: Create over quota
- **WHEN** a user who already owns the maximum number of active projects creates another
- **THEN** the system returns `403` with a structured quota-exceeded error and the project is not created

#### Scenario: Concurrent creates cannot overshoot
- **WHEN** multiple create requests for the same user arrive concurrently while exactly one slot remains
- **THEN** at most one project is created and the remaining requests return `403` with a quota-exceeded error

### Requirement: Maximum members per project
The system SHALL enforce a maximum number of members per project. The default maximum is 50 and SHALL be overridable via `QUOTA_MAX_MEMBERS_PER_PROJECT`. The count check and the membership creation (invite or accept) SHALL occur within a single transaction so that concurrent requests cannot both observe available capacity and overshoot the maximum.

#### Scenario: Invite within quota
- **WHEN** a project has fewer than the maximum members and a new member is added (invite or accept)
- **THEN** the membership is created normally

#### Scenario: Add member over quota
- **WHEN** a project already has the maximum members and an invitation is created or accepted
- **THEN** the system returns `403` with a quota-exceeded error and no new membership is created

#### Scenario: Concurrent invites cannot overshoot
- **WHEN** multiple membership requests for the same project arrive concurrently while exactly one slot remains
- **THEN** at most one membership is created and the remaining requests return `403` with a quota-exceeded error

### Requirement: Maximum entities per project
The system SHALL enforce a maximum total number of entities (collections, links, tasks, notes, todos) per project. The default maximum is 5000 and SHALL be overridable via `QUOTA_MAX_ENTITIES_PER_PROJECT`. The entity count check and the application of create mutations SHALL be serialized so that concurrent syncs cannot both observe available capacity and overshoot the maximum.

#### Scenario: Create within entity quota
- **WHEN** a sync applies create mutations that keep the project under the entity maximum
- **THEN** the mutations are applied normally

#### Scenario: Create over entity quota
- **WHEN** applying pending create mutations would exceed the project's entity maximum
- **THEN** the system returns `403` with a quota-exceeded error for the offending creates and does not persist them

#### Scenario: Concurrent syncs cannot overshoot
- **WHEN** concurrent syncs for the same project each carry creates that, combined, would exceed the remaining entity capacity
- **THEN** at most the available capacity is created and the overflow requests return `403` with a quota-exceeded error

### Requirement: Maximum sync mutations per request
The system SHALL reject a sync request carrying more than the configured maximum number of mutations. The default maximum is 200 and SHALL be overridable via `QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST`.

#### Scenario: Sync within mutation cap
- **WHEN** a sync request carries at most the maximum number of mutations
- **THEN** the sync proceeds normally

#### Scenario: Sync over mutation cap
- **WHEN** a sync request carries more than the maximum number of mutations
- **THEN** the system returns `400` (bad request) and applies no mutations

### Requirement: Configurable quota limits
Every usage-quota limit SHALL be overridable via an optional environment variable, falling back to the documented default when unset or invalid.

#### Scenario: Default used when unset
- **WHEN** no override env var is provided
- **THEN** the system uses the documented default for each quota

#### Scenario: Override applied
- **WHEN** a valid numeric override env var is provided
- **THEN** the system uses that value instead of the default

### Requirement: Quota guard failure does not commit dependents
When a quota-guard insert or update affects zero rows (quota reached), the system SHALL NOT execute any dependent statements of that operation. Specifically: no membership insert, no invitation acceptance, no version bumps, and no change-log rows SHALL be committed for an operation whose guard did not pass. The client SHALL receive the structured `403` quota error, never a derived `500`.

#### Scenario: Project creation at the cap
- **WHEN** a user at the project maximum creates a project
- **THEN** the response is `403` with a quota-exceeded error, no project row and no membership row is created, and no error is thrown

#### Scenario: Invitation acceptance at the member cap
- **WHEN** a project at the member maximum receives an invitation acceptance
- **THEN** the response is `403`, no membership is created, and the invitation remains unaccepted (retryable later)

#### Scenario: Entity creates at the entity cap
- **WHEN** a sync's create mutations are blocked by the entity quota
- **THEN** no version bumps and no change-log `create` rows are written for the blocked creates, so other clients never observe phantom entities

#### Scenario: Partial capacity applies only within capacity
- **WHEN** a sync carries more creates than the remaining entity capacity
- **THEN** creates within the remaining capacity are applied (with their changelog rows) and only the overflow is rejected with `403`

