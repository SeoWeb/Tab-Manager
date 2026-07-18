## ADDED Requirements

### Requirement: Maximum projects per user
The system SHALL enforce a maximum number of active (non-deleted) projects owned by a user. The default maximum is 10 and SHALL be overridable via `QUOTA_MAX_PROJECTS_PER_USER`.

#### Scenario: Create within quota
- **WHEN** a user with fewer than the maximum active projects creates a project
- **THEN** the project is created normally

#### Scenario: Create over quota
- **WHEN** a user who already owns the maximum number of active projects creates another
- **THEN** the system returns `403` with a structured quota-exceeded error and the project is not created

### Requirement: Maximum members per project
The system SHALL enforce a maximum number of members per project. The default maximum is 50 and SHALL be overridable via `QUOTA_MAX_MEMBERS_PER_PROJECT`.

#### Scenario: Invite within quota
- **WHEN** a project has fewer than the maximum members and a new member is added (invite or accept)
- **THEN** the membership is created normally

#### Scenario: Add member over quota
- **WHEN** a project already has the maximum members and an invitation is created or accepted
- **THEN** the system returns `403` with a quota-exceeded error and no new membership is created

### Requirement: Maximum entities per project
The system SHALL enforce a maximum total number of entities (collections, links, tasks, notes, todos) per project. The default maximum is 5000 and SHALL be overridable via `QUOTA_MAX_ENTITIES_PER_PROJECT`.

#### Scenario: Create within entity quota
- **WHEN** a sync applies create mutations that keep the project under the entity maximum
- **THEN** the mutations are applied normally

#### Scenario: Create over entity quota
- **WHEN** applying pending create mutations would exceed the project's entity maximum
- **THEN** the system returns `403` with a quota-exceeded error for the offending creates and does not persist them

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
