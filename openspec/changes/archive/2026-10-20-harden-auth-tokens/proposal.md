## Why

Access tokens currently live 30 days with no refresh, no revocation, and no `jti`; the verifier accepts tokens without an `expiry` (which then never expire); every request verifies the JWT twice and performs a D1 user upsert; and the realtime connection passes the token as a `?token=` query parameter, which leaks into logs and telemetry. A leaked token is therefore valid for a month and irrevocable.

## What Changes

- Require `exp` on every accepted token; shorten access-token lifetime (7 days) with silent renewal (clients re-mint on a schedule/401) and add `jti` for future revocation support.
- Move the realtime connection off query-string tokens: a short-lived one-time ticket endpoint (`POST /realtime/ticket`, 60 s TTL, single use) exchanged during the WebSocket handshake via the `Sec-WebSocket-Protocol` subprotocol field.
- Verify the JWT exactly once per request: `subjectOf` and `requireUser` share a single verification; the per-request D1 user upsert is skipped when the token's claims are unchanged (cached user snapshot validated against a `users.updated_at` check only on writes).
- Client side: the extension stores the token as today but renews before expiry via the background worker; 401 handling triggers a single re-auth prompt rather than repeated failures.

## Capabilities

### New Capabilities
- `token-lifecycle`: Issuance and validation rules for access tokens — mandatory `exp`, bounded lifetime with silent renewal, `jti` issuance, one-time realtime tickets replacing query-string tokens, and single verification per request.

### Modified Capabilities
<!-- None: the passwordless code flow, rate limiting, and authorization requirements are unchanged by token mechanics. -->

## Impact

- **Modified files**: `backend/src/lib/auth/jwt.ts` (require `exp`, `jti`, renewal endpoint support, single-verify helper), `backend/src/lib/auth/login.ts` (mint with `jti` + shorter `exp`), `backend/src/index.ts` (ticket endpoint, WS handshake via subprotocol, one-verify request context), `realtime.ts` (authenticate from ticket/subprotocol), extension `src/lib/cloudflareSync/client.ts` + `realtime` client + `storage.ts` (renewal + ticket flow), `background/index.ts` (renewal alarm).
- **API contract**: new `POST /realtime/ticket`; WebSocket handshake changes **BREAKING** for realtime clients (shipped together); token format gains `jti` (additive, old tokens without `jti` remain valid until their `exp`).
- **Compatibility**: existing 30-day tokens stay valid until expiry (verifier enforces `exp` presence only for newly minted tokens — minted after this change — to avoid logging out all users); optional `REQUIRE_EXP_ON_ALL_TOKENS=1` env flips the strict switch once the fleet has rotated.
