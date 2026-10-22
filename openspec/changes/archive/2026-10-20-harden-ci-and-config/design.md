## Context

The repo is hosted on GitHub (`SeoWeb/Tab-Manager`) and uses pnpm 9 at the root (with a `frontend` workspace member); `backend/` currently has its own npm lockfile. All quality gates exist locally (`pnpm run lint|typecheck|test|test:backend|build`) and pass in ~2 minutes total, so CI is pure wiring, not new tooling.

Current production config explicitly sets `ALLOWED_ORIGINS = "*"` (`backend/wrangler.toml:14`), and `cors.ts` defaults its allow-list to `['*']`, reflects the request `Origin` back with `Access-Control-Allow-Credentials: true`, and echoes arbitrary preflight method/header requests. Auth is bearer-token today (not cookies), so exploitability is limited, but the configuration violates the CORS spec and becomes account-compromising the moment cookie-based auth is introduced.

D1 schema changes are currently three hardcoded `wrangler d1 execute --file` commands chained with `&&` in `backend/package.json` (`migrate:local`, `migrate:remote`), repeated per migration file. A mid-chain failure leaves an unknown state and re-running re-executes everything.

Version strings live in two places that have already drifted: `public/manifest.json` (0.1.2) vs `package.json` (0.1.1). The build already has a `post-build.js` hook that rewrites `manifest.json` into `build/`.

## Goals / Non-Goals

**Goals:**
- Every push/PR is verified by the full existing gate suite with zero local discipline required.
- CORS fails closed and only serves explicitly configured origins (extension + dashboard).
- Schema changes are framework-tracked (`wrangler d1 migrations`), idempotent, and reviewable.
- One version number, one build output directory.

**Non-Goals:**
- Deploy automation (CI builds; deployment stays a manual `wrangler deploy` step for now).
- Changing any backend behavior beyond CORS (auth model, cookies, new endpoints).
- Restructuring `backend/` packaging (lockfile unification happens in the cleanup change).
- Rewriting migration 0003's content (that is the `secure-sync-backend` change; this change only changes *how* migrations are applied).

## Decisions

- **GitHub Actions with four jobs**: `lint` (eslint), `typecheck` (root + backend `tsc`), `test` (jest + backend vitest), `build` (production build, includes lint+typecheck via its own script — so `build` alone is a redundant-but-cheap final gate). Splitting jobs keeps failures diagnosable at a glance and lets required checks target individual gates. *Alternative:* one job running everything sequentially — simpler YAML but a lint failure hides behind a 2-minute queue and required-check granularity is lost.
- **pnpm via `pnpm/action-setup` with `version: 9` + `cache: pnpm` on `setup-node`.** Matches local 9.15.x; caching the pnpm store cuts repeat runs to well under a minute. Backend tests keep running through the root script (`pnpm run test:backend`) so CI mirrors the documented developer workflow.
- **CORS: exact-match allow-list parsed from `ALLOWED_ORIGINS`** (comma-separated). `*` is treated as invalid → warn + fail closed; unset → warn + fail closed. Preflight echoes `Access-Control-Allow-Methods`/`-Headers` from a fixed server-side list (`GET, POST, PATCH, DELETE, OPTIONS`; `Authorization, Content-Type`) intersected with the request, never copying arbitrary values. *Alternative:* origin-pattern matching (e.g. `*.ww0.dev`) — rejected: preview deployments can be enumerated explicitly, and exact matching is auditable.
- **Migrations: `[[migrations]]` is not used for D1** — instead `wrangler.toml` gains `[d1_databases] migrations_dir = "src/db/migrations"` (wrangler 4 supports this), and the scripts become `wrangler d1 migrations apply tab-manager-dev --local|/--remote`. Existing 0001–0003 files are registered as already-applied on any existing database via `wrangler d1 migrations list` + a one-time baseline apply on a copy first. *Alternative:* keep raw `d1 execute` but generate the file list with a glob — rejected: still no applied-state tracking.
- **Version sync in `post-build.js`**: read `package.json` version, rewrite `version` in the copied `build/manifest.json`. The checked-in `public/manifest.json` version becomes informational. *Alternative:* check both files equal in CI — rejected: still two sources; the build-time derivation removes the failure mode entirely.

## Risks / Trade-offs

- [Tightening CORS breaks an unknown web consumer] → Search deploy logs/access for non-extension origins before flipping; the allow-list is env-configurable so an origin can be added without a code change. The extension itself uses `host_permissions` and is unaffected by `Access-Control-Allow-Origin` for its own requests from the extension origin (which will be allow-listed).
- [`wrangler d1 migrations` baseline on an already-migrated remote DB] → Baseline via `migrations apply` on a staged copy (local replica of remote) first; `migrations list` confirms zero pending before touching remote. The existing 0003 content is unsafe on populated data regardless — remote migration stays frozen until `secure-sync-backend` lands.
- [CI minutes cost on every push] → Full suite is ~2–3 min with cache; concurrency group cancels superseded runs on the same PR.
- [post-build version rewrite surprises release tooling that diffs manifests] → The rewrite only touches `version`; `CHROME_STORE_LISTING.md` instructions are updated to bump `package.json` only.

## Migration Plan

1. Land CI first (pure addition, no behavior change).
2. Flip CORS in the same deploy as the `ALLOWED_ORIGINS` env update (extension origin + `https://tab-manager.ww0.dev`), verified against `wrangler dev` with a scripted cross-origin check.
3. Add `migrations_dir`, register 0001–0003 as the baseline locally, delete the chained scripts. Remote migration remains explicitly frozen until the migration-content fix lands.
4. Version sync + stale-artifact cleanup last (cosmetic).

Rollback: CI removal is trivial; CORS revert = restore previous `ALLOWED_ORIGINS` value via `wrangler.toml` redeploy; migrations framework is forward-only — rollback means not applying new migrations.

## Open Questions

- Exact production extension origin ID (needed for the allow-list) — to be read from the Chrome Web Store dashboard before the CORS deploy; placeholder goes in `.dev.vars.example`.
- Should `frontend/` deploy jobs join CI now or with the workspace cleanup? Default: build the frontend in CI (it is part of `pnpm install` anyway) but do not gate on its deploy.
