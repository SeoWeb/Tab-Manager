## Purpose

Protect the sync backend from abusive or malformed traffic: reject oversized request bodies, attach baseline security headers to every response, parse JSON through one shared hardened helper, and serve cross-origin requests only to an explicitly configured origin allow-list (failing closed when unconfigured or wildcard).
## Requirements
### Requirement: Request body size limit
The system SHALL reject JSON request bodies larger than a configured maximum (default 1 MB) on all JSON endpoints, including the auth request-code and verify routes, returning `413 Payload Too Large`.

#### Scenario: Body within limit
- **WHEN** a JSON request body is at or below the maximum size
- **THEN** the body is parsed and the request proceeds normally

#### Scenario: Body over limit
- **WHEN** a JSON request body exceeds the maximum size
- **THEN** the system returns `413` and does not parse or process the body

#### Scenario: Oversized auth request
- **WHEN** an `auth/request-code` or `auth/verify` body exceeds the maximum size
- **THEN** the system returns `413`

### Requirement: Security response headers
The system SHALL attach baseline security headers to every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.

#### Scenario: Headers on success
- **WHEN** any request completes successfully
- **THEN** the response includes the three security headers

#### Scenario: Headers on error
- **WHEN** the system returns an error response (e.g. `400`, `401`, `403`, `429`, `413`)
- **THEN** the response still includes the three security headers

### Requirement: Shared JSON parsing helper
The system SHALL parse JSON request bodies through a single shared helper that enforces the size limit and returns a `400`/`413` `Response` on malformed or oversized input, used by both `index.ts` routing and `lib/auth.ts`.

#### Scenario: Malformed JSON
- **WHEN** a request declares `application/json` but the body is not valid JSON
- **THEN** the shared helper returns a `400` `Response`

#### Scenario: Wrong content type
- **WHEN** a request body is not `application/json`
- **THEN** the shared helper returns a `400` `Response`

### Requirement: CORS origin allow-list
The system SHALL send `Access-Control-Allow-Origin` only for origins explicitly configured via `ALLOWED_ORIGINS`. The wildcard `*` MUST NOT be accepted as a configured origin, the list MUST NOT default to allowing all origins, and when `ALLOWED_ORIGINS` is unset the system SHALL fail closed (no `Access-Control-Allow-Origin` header on cross-origin responses). Preflight responses SHALL echo requested methods and headers only when they match a server-side allow-list, and `Access-Control-Allow-Credentials` SHALL be sent only when the request origin is explicitly allow-listed.

#### Scenario: Allow-listed origin is served
- **WHEN** a request arrives with an `Origin` header that exactly matches an entry in `ALLOWED_ORIGINS`
- **THEN** the response includes `Access-Control-Allow-Origin: <origin>` and, for credentialed requests, `Access-Control-Allow-Credentials: true`

#### Scenario: Unknown origin is rejected silently
- **WHEN** a request arrives with an `Origin` that is not in the allow-list
- **THEN** the response carries no `Access-Control-Allow-Origin` header and the browser blocks the cross-origin read

#### Scenario: Unconfigured deployment fails closed
- **WHEN** `ALLOWED_ORIGINS` is unset or empty
- **THEN** no cross-origin response includes an `Access-Control-Allow-Origin` header and startup logs a warning

#### Scenario: Wildcard configuration is rejected
- **WHEN** `ALLOWED_ORIGINS` is set to `*` (or contains `*`)
- **THEN** the system treats the value as invalid (warn and fail closed) rather than allowing all origins

#### Scenario: Preflight narrows methods and headers
- **WHEN** an `OPTIONS` preflight requests methods or headers outside the server allow-list
- **THEN** the preflight response does not echo the disallowed values

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

