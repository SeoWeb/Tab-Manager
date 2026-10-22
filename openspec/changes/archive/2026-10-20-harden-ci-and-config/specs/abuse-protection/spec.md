## ADDED Requirements

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
