## MODIFIED Requirements

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
