## ADDED Requirements

### Requirement: Expiry is mandatory on new tokens
Every token minted after this change SHALL carry an `exp` claim. The verifier SHALL reject newly minted tokens lacking `exp`. During the migration window, previously minted tokens without `exp` SHALL remain valid only until the strict mode (`REQUIRE_EXP_ON_ALL_TOKENS`) is enabled, after which all tokens require `exp`.

#### Scenario: Newly minted token without expiry is impossible
- **WHEN** the backend mints any access token
- **THEN** the token includes an `exp` claim within the configured lifetime

#### Scenario: Strict mode rejects exp-less tokens
- **WHEN** `REQUIRE_EXP_ON_ALL_TOKENS` is enabled and a request presents a token without `exp`
- **THEN** the request is rejected as unauthenticated

### Requirement: Bounded lifetime with silent renewal
Access-token lifetime SHALL be bounded (default 7 days, env-overridable, hard cap 30 days). Clients SHALL renew tokens silently before expiry (background scheduling), and a renewal SHALL mint a fresh token with a new `jti` and expiry without user interaction.

#### Scenario: Client renews before expiry
- **WHEN** a client's token approaches expiry (within a configurable renewal window)
- **THEN** the background worker obtains a new token without user interaction and sync continues uninterrupted

#### Scenario: Expired token triggers single re-auth
- **WHEN** a request fails with 401 due to expiry and renewal is not possible
- **THEN** the client prompts for re-authentication once, not per-request

### Requirement: Tokens carry a unique identifier
Every newly minted token SHALL include a unique `jti` claim, enabling future revocation lists without changing the verification path. `jti` values SHALL be collision-resistant and logged only in hashed form.

#### Scenario: Distinct tokens have distinct identifiers
- **WHEN** two tokens are minted (even for the same user in the same second)
- **THEN** their `jti` claims differ

### Requirement: Realtime auth uses one-time tickets
The WebSocket realtime connection SHALL NOT accept tokens from query parameters. Clients SHALL obtain a short-lived, single-use ticket (`POST /realtime/ticket`, default 60 s TTL) with their access token and present it during the handshake via the `Sec-WebSocket-Protocol` field. A ticket SHALL be consumable exactly once and SHALL NOT grant access to any HTTP endpoint.

#### Scenario: Ticket exchange and connect
- **WHEN** a client requests a ticket with a valid access token and opens the WebSocket presenting it in the subprotocol field
- **THEN** the connection is authenticated and the ticket cannot be used again

#### Scenario: Ticket replay is rejected
- **WHEN** the same ticket is presented for a second handshake
- **THEN** the connection is refused

#### Scenario: Expired ticket is rejected
- **WHEN** a ticket older than its TTL is presented
- **THEN** the connection is refused

#### Scenario: Tokens no longer appear in URLs
- **WHEN** any authenticated connection is established (HTTP or WebSocket)
- **THEN** no access token appears in the request URL or query string

### Requirement: Single verification per request
An authenticated HTTP request SHALL verify the JWT exactly once. Internal helpers SHALL NOT re-verify the same token within one request, and the per-request user lookup SHALL be skipped when the token's subject/claims match the request context already established (write paths may still re-validate user state as required for correctness).

#### Scenario: One crypto verification per request
- **WHEN** an authenticated request traverses subject extraction and user resolution
- **THEN** the JWT signature is verified once for the request

#### Scenario: Read paths skip redundant user writes
- **WHEN** an authenticated read-only request arrives with claims unchanged since the token was minted
- **THEN** no user upsert is performed for that request
