## Why

Nothing verifies the project automatically: there is no CI, so lint/typecheck/tests/build only run when a developer remembers. Meanwhile the production backend config allows any origin (`ALLOWED_ORIGINS = "*"` with credentials), D1 "migrations" are chained `&&` shell scripts that can leave the database half-migrated, the manifest (0.1.2) and package.json (0.1.1) versions have drifted, and stale build artifacts (`out/`, `dist/`, `.next/`, `.swc/`) confuse the build story. Every subsequent hardening phase needs this safe foundation first.

## What Changes

- Add a GitHub Actions workflow that runs lint, typecheck, extension tests (jest), backend tests (vitest), and the production build on every push and pull request, failing the PR on any red gate.
- Lock down CORS: remove the wildcard default and the `ALLOWED_ORIGINS = "*"` production value; the backend serves only an explicit origin allow-list (extension origin + dashboard origin), fails closed when the variable is unset, and stops reflecting arbitrary request methods/headers in preflight.
- Replace the chained `migrate:local` / `migrate:remote` shell scripts with `wrangler d1 migrations` (add `migrations_dir` to `wrangler.toml`); run remote migrations only as a deliberate, logged step.
- Single-source the release version: `manifest.json` version is derived from `package.json` during the build so they can never drift again.
- Remove stale build artifacts and stray files from the working tree and document the one true output directory (`build/`).

## Capabilities

### New Capabilities
- `ci-pipeline`: GitHub Actions workflow enforcing all quality gates (lint, typecheck, jest, backend vitest, production build) on pushes and PRs, with a per-job breakdown and pnpm caching.
- `release-engineering`: Version single-sourcing (manifest derives from package.json), D1 schema changes applied only through `wrangler d1 migrations`, and a single canonical build output directory.

### Modified Capabilities
- `abuse-protection`: Adds an origin allow-list requirement — CORS must serve only explicitly configured origins, fail closed when unconfigured, and echo only allow-listed preflight request methods/headers.

## Impact

- **New files**: `.github/workflows/ci.yml`.
- **Modified files**: `backend/wrangler.toml` (`ALLOWED_ORIGINS`, `migrations_dir`), `backend/src/lib/cors.ts` (strict origin matching, no wildcard reflection), `backend/package.json` (migration scripts via wrangler CLI), `post-build.js` (version sync), `.gitignore` (artifact dirs), `README.md`/`BUILD_INSTRUCTIONS.md` (build-output docs).
- **Removed**: stale `out/`, `dist/`, `.next/`, `.swc/` directories and the empty `.modified` file (local artifacts; all gitignored).
- **Risk**: tightening CORS is **BREAKING** for any non-extension web client relying on reflected origins — verified none exist before deploy; the allow-list ships the extension origin so the extension is unaffected.
