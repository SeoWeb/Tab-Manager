## ADDED Requirements

### Requirement: Schema validation on all JSON endpoints
Every JSON endpoint SHALL validate its parsed body against a schema (zod) that constrains field types, string lengths, and value ranges. Bodies failing validation SHALL be rejected with `400` and a field-level error summary. Hand-rolled `typeof`/`as` casting SHALL NOT be the sole validation for any request body.

#### Scenario: Oversized field is rejected
- **WHEN** a create/update body carries a name or description exceeding its length limit (e.g. 200 / 2000 chars)
- **THEN** the request is rejected with `400` identifying the offending field

#### Scenario: Malformed types are rejected
- **WHEN** a body field has the wrong type (e.g. `tags` as a string where an array is required)
- **THEN** the request is rejected with `400` before any handler logic runs

### Requirement: Bounded invitation expiry
`expiresInDays` on invitation creation SHALL be bounded to a server-side range (1–30 days, default 7). Out-of-range values SHALL be rejected with `400`, not clamped or accepted.

#### Scenario: Negative expiry is rejected
- **WHEN** an invitation is created with `expiresInDays: -5`
- **THEN** the request fails with `400`

#### Scenario: Absurd expiry is rejected
- **WHEN** an invitation is created with `expiresInDays: 1000000000`
- **THEN** the request fails with `400`

### Requirement: Symmetric name validation
Project names SHALL be trimmed and length-validated identically on create and update; a whitespace-only or over-length name SHALL be rejected in both paths.

#### Scenario: Whitespace-only update is rejected
- **WHEN** a project update sets the name to spaces
- **THEN** the update is rejected with `400`
