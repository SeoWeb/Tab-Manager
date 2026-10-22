## ADDED Requirements

### Requirement: Conflicts and infrastructure failures are distinct
A sync response SHALL report a *conflict* only for genuine data-level conflicts (version mismatch, missing target, project mismatch). Infrastructure failures (D1 errors, constraint violations, internal exceptions) SHALL produce an HTTP `5xx` response carrying a `retryable: true` marker, never a `200` with a conflict entry, so clients retry instead of treating them as data conflicts.

#### Scenario: Transient D1 failure is retryable
- **WHEN** a D1 statement fails with an internal error during mutation apply
- **THEN** the client receives a `5xx` response with `retryable: true` and the queued mutation is retained for retry

#### Scenario: Genuine version conflict is a conflict
- **WHEN** a mutation's `baseVersion` does not match the current version
- **THEN** the client receives a `200` response with a conflict entry for that mutation

### Requirement: No internal detail leakage in error messages
Client-visible error and conflict messages SHALL NOT contain SQL text, constraint names, stack traces, or driver internals. Messages SHALL be stable, human-readable summaries; details SHALL go to server logs only.

#### Scenario: Constraint violation is sanitized
- **WHEN** an insert fails with a foreign-key or unique-constraint error
- **THEN** the client-visible message is a generic failure summary and the constraint name appears only in logs
