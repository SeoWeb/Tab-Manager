# ci-pipeline Specification

## Purpose
TBD - created by archiving change harden-ci-and-config. Update Purpose after archive.
## Requirements
### Requirement: Continuous integration gates
The repository SHALL define a GitHub Actions workflow that runs on every push to the main branch and on every pull request, executing: ESLint (`pnpm run lint`), TypeScript checks (root `tsc --noEmit` and backend `tsc --noEmit`), extension tests (`pnpm test`), backend tests (`pnpm run test:backend`), and a full production build (`pnpm run build`). The pull request SHALL be blocked (required check) when any job fails.

#### Scenario: All gates green
- **WHEN** a push or PR introduces changes that pass lint, typecheck, both test suites, and the build
- **THEN** the workflow completes successfully and the PR is mergeable

#### Scenario: Any gate fails
- **WHEN** any of lint, typecheck, extension tests, backend tests, or the build fails on a PR
- **THEN** the workflow fails and the failing job identifies the broken gate

#### Scenario: Backend changes run backend gates
- **WHEN** a PR modifies files under `backend/`
- **THEN** the workflow runs backend typecheck and vitest suites in addition to the extension gates

### Requirement: CI dependency caching
The workflow SHALL cache pnpm's store so repeated runs do not re-download dependencies, and SHALL use a pinned pnpm version matching local development.

#### Scenario: Repeated runs reuse the cache
- **WHEN** the workflow runs twice with an unchanged `pnpm-lock.yaml`
- **THEN** the second run restores dependencies from cache instead of downloading them

