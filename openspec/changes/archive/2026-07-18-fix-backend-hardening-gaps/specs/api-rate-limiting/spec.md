## MODIFIED Requirements

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
