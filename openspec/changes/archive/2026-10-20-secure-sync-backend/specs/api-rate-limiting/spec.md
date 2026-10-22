## ADDED Requirements

### Requirement: Rate-limit state survives eviction
The `RateLimiter` Durable Object SHALL persist sliding-window timestamps to Durable Object storage (write-through with an in-memory fast path) so that eviction, hibernation, or restart does not reset any window. The existing alarm-based reclamation of drained instances SHALL delete the persisted state as before.

#### Scenario: Window survives DO restart
- **WHEN** a rate-limited key has requests recorded and the Durable Object is evicted and re-created
- **THEN** subsequent checks still count the pre-eviction requests within the window

#### Scenario: Drained instance is still reclaimed
- **WHEN** all timestamps in a window expire and the alarm fires
- **THEN** the persisted state is deleted and the instance can be garbage-collected

#### Scenario: Brute-force budget spans restarts
- **WHEN** an attacker spreads verify attempts across a DO restart
- **THEN** the per-IP and per-key budgets continue to be enforced across the restart boundary
