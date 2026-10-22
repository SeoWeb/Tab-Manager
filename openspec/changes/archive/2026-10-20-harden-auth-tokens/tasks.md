## 1. Token Minting & Verification

- [x] 1.1 In `jwt.ts`: add `TOKEN_TTL_SECONDS` (default 604800, cap 2592000) and `jti` (crypto.randomUUID) on mint; export a `legacy` flag from verification for tokens without `exp`/`jti`
- [x] 1.2 Keep `exp`-less tokens valid but logged during migration; honor `REQUIRE_EXP_ON_ALL_TOKENS=1` to reject them
- [x] 1.3 Update `login.ts` verify path to mint with new TTL + `jti`; add tests: minted tokens always carry `exp`+`jti`; distinct `jti` per mint; strict-mode rejects `exp`-less tokens
- [x] 1.4 Add `POST /auth/renew`: requires valid current token, returns freshly minted token; rate-limited in the authenticated tier; tests for valid, expired, and rate-limited renewals

## 2. Single Verification & Read-Path Cost

- [x] 2.1 Refactor to a memoized `getAuth(request)` context (WeakMap) used by both `subjectOf` and `requireUser`; assert one verification per request via unit test (spy on verify)
- [x] 2.2 Move the per-request `users` upsert off read paths: reads trust token claims; upsert on write paths and first-seen `jti` (DO-storage LRU)
- [x] 2.3 Test: read request performs zero user writes; write request upserts as before

## 3. Realtime Tickets

- [x] 3.1 Add `POST /realtime/ticket`: auth required; returns HMAC ticket `{ticket, expiresAt}` bound to `userId`, `projectId`, 60 s TTL, random nonce; rate-limited
- [x] 3.2 In `realtime.ts`: verify ticket on upgrade from the `Sec-WebSocket-Protocol` field (respond with the single supported protocol token); reject missing/expired/malformed tickets with a proper WS close
- [x] 3.3 Persist consumed nonces in DO storage (write-through) for single-use enforcement across eviction; reject replays
- [x] 3.4 Remove the `?token=` query-param path from the upgrade handler
- [x] 3.5 Tests: ticket happy path; replay rejected; expired rejected; URL never contains a token; invalid subprotocol handshake fails cleanly

## 4. Extension Client Updates

- [x] 4.1 In `src/lib/cloudflareSync/realtime` client: request a ticket before connecting and pass it via subprotocol; handle ticket failure by triggering normal re-auth flow
- [x] 4.2 Add background renewal: parse `exp` from the stored token, set `chrome.alarms` at T-24h, renew via `/auth/renew`, persist the new token; exponential backoff on failure; single 401 re-auth prompt
- [x] 4.3 Update `client.ts` 401 handling: attempt one renewal then retry once; only prompt on renewal failure
- [x] 4.4 Tests: renewal alarm schedules correctly; 401 → renew → retry; prompt shown once on unrecoverable expiry

## 5. Migration Cutover

- [x] 5.1 Document the 30-day cutover in `deployment.md`: enable `REQUIRE_EXP_ON_ALL_TOKENS=1` after one legacy-token lifetime; add a startup log counting remaining legacy tokens
- [x] 5.2 Remove the legacy token branch in a follow-up cleanup task after cutover
