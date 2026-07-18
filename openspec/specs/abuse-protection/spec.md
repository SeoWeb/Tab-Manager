## ADDED Requirements

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
