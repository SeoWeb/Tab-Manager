## ADDED Requirements

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
