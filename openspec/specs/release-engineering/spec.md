# release-engineering Specification

## Purpose
TBD - created by archiving change harden-ci-and-config. Update Purpose after archive.
## Requirements
### Requirement: Single-source release version
The build SHALL derive `manifest.json`'s `version` from `package.json`'s `version` at build time, so the packaged extension version always equals the package version and manual drift is impossible.

#### Scenario: Versions stay in sync
- **WHEN** the package version is bumped in `package.json` and the production build runs
- **THEN** the emitted `build/manifest.json` carries the same version string

#### Scenario: Mismatched checked-in manifest is corrected
- **WHEN** `public/manifest.json` contains a version that differs from `package.json`
- **THEN** the build output still uses the `package.json` version (the source manifest is not authoritative)

### Requirement: Migrations run through the migrations framework
D1 schema changes SHALL be applied only via `wrangler d1 migrations` with `migrations_dir` configured in `wrangler.toml`. The project MUST NOT apply schema changes through chained `d1 execute --file` shell scripts, so each migration runs exactly once and application order/status is tracked by the framework.

#### Scenario: Fresh local database
- **WHEN** a developer runs the local migration command against an empty database
- **THEN** `wrangler d1 migrations apply` applies all pending migrations in order and records them as applied

#### Scenario: Re-running is idempotent
- **WHEN** the migration command runs again with no new migration files
- **THEN** no migrations are re-applied and the database is unchanged

### Requirement: Single canonical build output
The Next.js static export (`distDir: 'build'`) SHALL be the only build output directory. Stale artifact directories from earlier build schemes (`out/`, `dist/`, `.next/`, `.swc/`) SHALL NOT be treated as build outputs by any script, command, or documented instruction.

#### Scenario: Documentation points to one output
- **WHEN** a developer follows `README.md` or `BUILD_INSTRUCTIONS.md` to build the extension
- **THEN** the instructions reference `build/` only and no script writes to or reads from the legacy directories

