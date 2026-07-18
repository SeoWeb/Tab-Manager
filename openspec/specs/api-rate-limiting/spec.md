## ADDED Requirements

### Requirement: Rate limiter Durable Object
The system SHALL provide a `RateLimiter` Durable Object that maintains a precise sliding-window counter per rate-limit key, returning a decision of `{ allowed, limit, remaining, resetAt, retryAfter }` for each check. When the instance's window has fully drained (no in-window timestamps remain after pruning), the instance SHALL delete its stored state so the Durable Object is reclaimed rather than persisting indefinitely with empty state.

#### Scenario: Within-window allowance
- **WHEN** a key has fewer than `limit` requests recorded within the preceding `windowMs`
- **THEN** the check returns `allowed = true` with `remaining = limit - count` and `retryAfter = 0`

#### Scenario: Over-window denial
- **WHEN** a key already has `limit` requests within the preceding `windowMs`
- **THEN** the check returns `allowed = false` with `remaining = 0` and `retryAfter` equal to seconds until the oldest request exits the window

#### Scenario: Expired entries are pruned
- **WHEN** a request timestamp is older than `windowMs`
- **THEN** it is excluded from the count and does not block new requests

#### Scenario: Idle instance storage is reclaimed
- **WHEN** the `alarm()` fires after all in-window timestamps have expired
- **THEN** the instance's stored state is deleted and the Durable Object is freed for garbage collection

### Requirement: Tiered rate limits at the edge
The system SHALL enforce, at the `fetch` entrypoint and before routing, a global per-IP limit plus endpoint-specific limits for authenticated API, sync, and the auth request-code / verify routes. Limits SHALL be configurable via env vars with the stated defaults (per 60s window).

#### Scenario: Global per-IP limit
- **WHEN** an IP exceeds 120 requests per minute (default)
- **THEN** the system returns `429` with a `Retry-After` header

#### Scenario: Authenticated API per-user limit
- **WHEN** an authenticated user exceeds 300 API requests per minute (default)
- **THEN** the system returns `429`

#### Scenario: Sync per-user limit
- **WHEN** an authenticated user exceeds 60 sync requests per minute (default)
- **THEN** the system returns `429`

#### Scenario: Auth route per-IP limits
- **WHEN** an IP exceeds 10 `auth/request-code` or 20 `auth/verify` requests per minute (defaults)
- **THEN** the system returns `429`

#### Scenario: Preflight is not rate limited
- **WHEN** a request uses the `OPTIONS` method
- **THEN** rate-limit checks are skipped

### Requirement: Rate-limit response and header contract
On a rate-limit breach the system SHALL return `429` including `Retry-After` and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. On success the system SHALL attach `X-RateLimit-*` headers to the response. All such responses SHALL be CORS-wrapped.

#### Scenario: 429 carries retry and limit headers
- **WHEN** a rate limit is exceeded
- **THEN** the response has status `429`, a `Retry-After` header, and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers

#### Scenario: Success carries limit headers
- **WHEN** a request is allowed
- **THEN** the response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` for the enforced tier

### Requirement: Configurable thresholds
Every rate-limit threshold SHALL be overridable via an optional environment variable, falling back to the documented default when unset or invalid.

#### Scenario: Default used when unset
- **WHEN** no override env var is provided
- **THEN** the system uses the documented default for each tier

#### Scenario: Override applied
- **WHEN** a valid numeric override env var is provided
- **THEN** the system uses that value instead of the default
