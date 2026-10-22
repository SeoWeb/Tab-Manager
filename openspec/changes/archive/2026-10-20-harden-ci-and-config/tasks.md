## 1. CI Pipeline

- [x] 1.1 Create `.github/workflows/ci.yml` with `concurrency` cancellation per PR ref and jobs: `lint`, `typecheck`, `test`, `build` (all `ubuntu-latest`)
- [x] 1.2 Set up pnpm 9 via `pnpm/action-setup` and Node 20 via `setup-node` with `cache: pnpm` in every job; run `pnpm install --frozen-lockfile`
- [x] 1.3 `lint` job: `pnpm run lint`; `typecheck` job: `pnpm run typecheck` and `npm --prefix backend run typecheck`; `test` job: `pnpm test` and `pnpm run test:backend`; `build` job: `pnpm run build` with the `build/` output uploaded as an artifact
- [x] 1.4 Add a `backend-changes` path filter so backend jobs always run on `backend/**` changes and via `workflow_dispatch`
- [x] 1.5 Verify a deliberately broken lint and a deliberately failing test both turn the workflow red with the failing job identifiable

## 2. CORS Lockdown

- [x] 2.1 In `backend/src/lib/cors.ts`, parse `ALLOWED_ORIGINS` as a comma-separated exact-match list; reject/treat `*` as invalid (warn + fail closed); when unset, serve no `Access-Control-Allow-Origin` and log a startup warning
- [x] 2.2 Send `Access-Control-Allow-Credentials: true` only for allow-listed origins; keep security headers from the existing abuse-protection work intact
- [x] 2.3 Restrict preflight echoes to server-side allow-lists: methods `GET, POST, PATCH, DELETE, OPTIONS`, headers `Authorization, Content-Type`, intersected with `Access-Control-Request-*`; drop the arbitrary echo
- [x] 2.4 Replace `ALLOWED_ORIGINS = "*"` in `backend/wrangler.toml` with the real extension origin + dashboard origin; document both in `.dev.vars.example`
- [x] 2.5 Add unit tests in `backend/src/lib/__tests__/cors.test.ts`: allow-listed origin, unknown origin, unset var, `*` value, preflight narrowing, credentials only on match

## 3. Migration Framework

- [x] 3.1 Add `migrations_dir = "src/db/migrations"` to the D1 binding in `backend/wrangler.toml`
- [x] 3.2 Replace `migrate:local`/`migrate:remote` with `wrangler d1 migrations apply tab-manager-dev --local|--remote`; keep `migrate:remote` behind an explicit confirmation step in `deployment.md`
- [x] 3.3 Verify baseline on a local copy: `d1 migrations list` then `apply` against a database migrated with the old scripts reports the expected pending set; document the one-time baseline procedure in `deployment.md`
- [x] 3.4 Add a bold freeze notice to `deployment.md`: remote migrations stay frozen until the `secure-sync-backend` change rewrites migration 0003

## 4. Version Sync & Artifact Cleanup

- [x] 4.1 In `post-build.js`, rewrite `build/manifest.json`'s `version` from `package.json` during the build; update `CHROME_STORE_LISTING.md` release instructions to bump `package.json` only
- [x] 4.2 Align the checked-in `public/manifest.json` version with `package.json` (choose the higher, 0.1.2, and bump `package.json` to match)
- [x] 4.3 Delete stale local artifacts (`out/`, `dist/`, `.next/`, `.swc/`, `.modified`) and confirm `.gitignore` covers every current and legacy output directory
- [x] 4.4 Update `README.md` and `BUILD_INSTRUCTIONS.md` to reference `build/` as the single output directory; remove `out/` references
