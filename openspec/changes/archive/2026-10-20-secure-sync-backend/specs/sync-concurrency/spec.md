## ADDED Requirements

### Requirement: Mutation idempotency is enforced by the database
The system SHALL enforce a database UNIQUE constraint on `sync_changes.client_mutation_id` (per project) so concurrent duplicate submissions cannot both apply. The application layer SHALL treat a unique-violation on insert as "already applied" and report the mutation as idempotently successful, not as an error.

#### Scenario: Concurrent duplicate creates apply once
- **WHEN** the same create mutation (same `client_mutation_id`) is submitted twice concurrently
- **THEN** the entity is created once, one changelog row exists, and the losing request is answered as already-applied

#### Scenario: Pre-existing duplicates are resolved before constraint
- **WHEN** the uniqueness migration is applied
- **THEN** existing duplicate `client_mutation_id` rows are de-duplicated (keeping the earliest) so the constraint creation succeeds

### Requirement: Version increments are compare-and-swap
Applying a mutation SHALL increment an entity's version with a conditional update (`SET version = version + 1 WHERE id = ? AND version = <expected>`) and SHALL treat 0 affected rows as a conflict. The expected version SHALL be established in the same batch as the conditional update, not in a separate earlier round-trip, so two concurrent mutations with the same base version cannot both succeed.

#### Scenario: Concurrent updates with the same base version
- **WHEN** two clients submit updates for the same entity with the same `baseVersion` concurrently
- **THEN** exactly one update applies and bumps the version; the other receives a conflict

### Requirement: Per-mutation outcome reporting
A sync response SHALL report an explicit outcome for every submitted mutation: `applied`, `conflict`, `skipped` (with a machine-readable reason, e.g. project mismatch), or `error`. The system MUST NOT silently drop a submitted mutation without a corresponding outcome entry.

#### Scenario: Project-mismatched update is reported
- **WHEN** a sync carries an update mutation that fails the project-scoping check
- **THEN** the response includes an outcome entry for that mutation with `skipped` and a project-mismatch reason, and the client can surface or retry it

#### Scenario: Client reconciles from outcomes
- **WHEN** the extension receives a sync response
- **THEN** it removes queued mutations only for outcomes of `applied`, resolved `conflict`, or explicitly acknowledged `skipped` — never for `error`
