## Context

`jwt.ts` signs HS256 tokens with a startup-validated ≥32-char secret; `subjectOf()` (index.ts) verifies a token to extract the subject, then `requireUser` verifies again and upserts/reads the user row on *every* authed request. Tokens minted at verify carry `exp` = now + 30 days; the verifier's check `if (payload.exp && payload.exp < now)` treats a missing `exp` as never-expiring. The realtime upgrade handler reads `?token=`. The extension stores the token plaintext in `chrome.storage.local` (the only practical option for an extension — `chrome.storage` is profile-scoped and not exportable by web pages; this is accepted and out of scope).

## Goals / Non-Goals

**Goals:**
- No never-expiring tokens; bounded lifetimes with invisible renewal.
- No tokens in URLs.
- One verification and (where possible) zero D1 writes per authed request.
- `jti` groundwork so a future revocation story doesn't require token-format churn again.

**Non-Goals:**
- Full revocation infrastructure (denylist DO/table) — `jti` is groundwork only.
- Refresh-token rotation with server-side session state — silent re-mint via the existing passwordless identity is sufficient at this scale; sessions-table machinery is deferred until a real need (compromise response = secret rotation today).
- Asymmetric signing (RS256/EdDSA) — single-worker issuer/verifier makes HS256 appropriate.
- Changing the passwordless code flow (owned by `secure-sync-backend`).

## Decisions

- **7-day default lifetime + client renewal at T-24h.** `TOKEN_TTL_SECONDS` env (default 604800, cap 2592000). The background worker sets a `chrome.alarms` for `exp - 24h`; on fire it calls the existing verify-derived identity to mint a fresh token via a new `POST /auth/renew` (authenticated with the current valid token; no code re-entry). If renewal fails (network), it retries with backoff; on hard 401 the UI shows the single sign-in prompt. *Alternative:* refresh tokens — two token types, storage and rotation logic, for a benefit (revocation) we're not shipping yet.
- **`POST /auth/renew` vs. reusing `/auth/verify`:** renew requires a *valid current token* (not a code), returns a new token, and is rate-limited under the authenticated tier. Old token stays valid until natural expiry (no rotation revocation) — documented trade-off consistent with no-revocation scope.
- **One-time tickets for realtime:** `POST /realtime/ticket` (auth-tier rate limit) returns `{ticket, expiresAt}`; ticket = HMAC(secret, `rt:{userId}:{projectId}:{exp}:{nonce}`) — stateless, so the DO verifies it without a D1 round-trip and marks nonces consumed in DO storage (single DO per project makes single-use check trivial). Client passes it as a `Sec-WebSocket-Protocol` entry (`tabspace-auth, <ticket>`) — headers aren't available in the browser WebSocket API, and query params leak; the server must echo the requested subprotocol list per RFC 6455 (implement carefully: respond with the supported protocol only). Connect-time presence name/role is restored via a single D1 lookup after ticket verification (auth itself stays stateless/D1-free). *Alternative:* cookie-based — extension pages can use cookies but it couples CORS/credentials work; subprotocol is self-contained.
- **Single verification:** `subjectOf` is refactored into a request-context helper (`getAuth(request)` memoized on the Request via a WeakMap in module scope for the isolate's lifetime of the request) returning `{userId, payload}`; `requireUser` consumes the context. D1 user upsert moves to write paths and a daily-touched cache: reads use the token claims; `users` row is upserted only when the handler mutates user state or on first-seen `jti` (a tiny `seen_jti` LRU in DO storage avoids repeat upserts per token). *Alternative:* cache user in the JWT itself entirely — token bloat and stale-role risk; roles must be fresh for authorization.
- **Migration window:** verifier flags `exp`-less tokens as `legacy` (valid, logged); `REQUIRE_EXP_ON_ALL_TOKENS=1` flips after one token lifetime (30 days post-deploy). `jti` absent in legacy tokens is tolerated. Client renewal alarm ships in the same release so the fleet rotates within days, not weeks.

## Risks / Trade-offs

- [Users offline > renewal window get logged out] → Renewal window T-24h with background retries makes this rare; hard 401 path is a single clear prompt (email code re-entry).
- [Stateless tickets + DO nonce store: DO eviction could allow one replay] → Nonce store is write-through to DO storage (persisted across eviction, same pattern as the rate limiter); worst case without persistence is a 60 s replay window scoped to one project room — accepted and mitigated.
- [`Sec-WebSocket-Protocol` handling bugs (echoing client list) break connections] → Server responds with exactly one supported protocol token; contract tests cover present/absent/invalid ticket cases.
- [WeakMap request memoization leaks across requests if Requests are retained] → Requests are not retained past handler return in this codebase (audited); the WeakMap dies with the isolate.
- [Skipping user upsert on reads changes "last seen" bookkeeping if any exists] → Audit confirms no read-path column depends on the upsert today; if one is added later it belongs on write paths.

## Migration Plan

1. Ship `jti` + bounded TTL on mint + `legacy`-tolerant verifier + `/auth/renew` + client renewal alarm (additive; no break).
2. Ship ticket endpoint + DO nonce store + WS subprotocol auth + client update (breaking for realtime — same release).
3. After 30 days (one full legacy-token lifetime), enable `REQUIRE_EXP_ON_ALL_TOKENS=1` and drop the legacy branch.

Rollback: step 1/2 revert by redeploy (old clients re-handshake with query param only if server also reverted — coordinate); step 3 is a config flip.

## Open Questions

- Renewal window (T-24h) vs. alarm minimum granularity in MV3 (fine — alarms ≥ 30 s; 24 h is trivial) — confirm battery/behavior on Chrome for Android if ever ported.
- Should `/auth/renew` also rotate an optional `displayName` update path? (Default: no — keep it single-purpose.)
