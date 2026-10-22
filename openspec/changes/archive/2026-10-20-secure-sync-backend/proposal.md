## Why

The sync backend has a cross-project authorization gap: entity existence checks, updates, and deletes filter by entity ID only and never verify the entity belongs to the route's project, so an editor of any project can move, modify, or delete another project's data (and the "move" fans the victim's data out to the attacker's project — exfiltration). Quota enforcement commits its dependent writes even when the guard inserts nothing, corrupting invitations and changelogs. Concurrency controls (versions, idempotency, login-code attempts) are advisory read-then-write races, removed members keep live realtime feeds, internal D1 errors leak to clients as "conflicts", and request validation is manual and spotty.

## What Changes

- **BREAKING** (protocol-tightening): every entity read/write/delete in the sync engine SHALL be scoped by the route's `project_id`; updates MUST carry `baseVersion` (conflict when absent); changelog rows are always written to the owning entity's project; skipped mutations are reported per-mutation instead of silently dropped.
- Quota guards become truly atomic: when the guarded insert affects 0 rows, dependents do not run — no burned invitations, no phantom changelog rows, `403` (not FK-driven `500`).
- Concurrency hardening: `UNIQUE` constraint on `sync_changes.client_mutation_id`, compare-and-swap version increments (`WHERE version = ?`), atomic login-code attempt counting and single-use consumption.
- Realtime revocation: removing a member or changing their role closes their project-room sockets immediately.
- Rate-limiter windows persist in Durable Object storage so eviction/restart does not reset them.
- Error contract: infrastructure failures return `5xx` with a `retryable` marker and never embed D1/SQL internals in client-visible messages; conflicts remain `200`-with-conflict only for genuine data conflicts.
- Schema validation: zod schemas for all request bodies; bounded `expiresInDays` (1–30); length limits on names, descriptions, tags, and payload fields.
- Privilege fixes: project deletion requires owner; names trimmed/validated symmetrically on create and update.

## Capabilities

### New Capabilities
- `sync-authorization`: Project-scoped access to every entity operation in the sync engine — existence/version reads, updates, deletes, and changelog ownership are bound to the route's project; updates require a base version; membership revocation closes realtime access.
- `sync-concurrency`: Compare-and-swap version increments, unique mutation idempotency, and per-mutation outcome reporting so concurrent or duplicate submissions cannot double-apply or silently vanish.
- `auth-code-flow`: Atomic, brute-force-resistant passwordless login codes — single-use consumption, server-side attempt caps enforced atomically, bounded expiry, and no attacker-controlled email content.
- `sync-error-handling`: Consistent failure contract — genuine conflicts vs. infrastructure errors, `retryable` marker on `5xx`, and no internal error detail leakage.

### Modified Capabilities
- `usage-quotas`: Adds commit-semantics requirements — quota guard failure MUST NOT commit dependent writes (invitation acceptance, membership inserts, changelog/version bumps).
- `api-rate-limiting`: Adds durability — sliding-window state survives Durable Object eviction and restart.
- `abuse-protection`: Adds request schema validation with bounded fields and string-length limits on all JSON endpoints.

## Impact

- **Modified files**: `backend/src/lib/sync/queries.ts`, `sync/applyMutation.ts`, `sync/mutations.ts`, `sync/statements/*.ts` (project scoping + CAS), `sync.ts` (per-mutation status), `lib/quotas.ts` + `crud.ts` + `invitations.ts` (two-phase quota commits), `lib/membership.ts` + `realtime.ts` + `index.ts` (revocation), `lib/ratelimit.ts` (DO storage persistence), `lib/crud.ts` (owner-only delete, trim), `lib/auth/login.ts` (atomic codes), `response.ts` (error contract), new `lib/validation.ts` (zod schemas).
- **Migrations**: one new migration adding `UNIQUE` index on `sync_changes.client_mutation_id` (after de-duplicating existing rows).
- **API contract**: new per-mutation `skipped`/`conflict` outcome list in the sync response; `5xx` gains `retryable`; conflict messages become generic. **BREAKING** for any client that relied on missing `baseVersion` being accepted (the bundled extension always sends it).
- **Dependencies**: adds `zod` to the backend.
