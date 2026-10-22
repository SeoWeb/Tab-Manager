## Purpose

Keep the codebase maintainable as it grows: source files stay small and cohesive, the production bundle contains only production code, shared constants and modules have single canonical homes, and one package manager governs all workspaces.
## Requirements
### Requirement: Large source files are split into cohesive modules
Any source file in `src/` or `backend/src/lib/` that exceeds 400 lines SHALL be split into smaller, cohesive modules so that no resulting source file exceeds ~400 lines.

#### Scenario: File exceeds threshold
- **WHEN** a source file has more than 400 lines
- **THEN** its distinct concerns are extracted into separate sibling files or a co-located sub-directory

### Requirement: Original import paths remain valid
After extraction, every symbol previously exported from the original file path MUST continue to be importable from that same path.

#### Scenario: Consumer imports unchanged
- **WHEN** existing code imports a symbol from the original file path
- **THEN** the import resolves without modification because the original file re-exports the extracted symbols

### Requirement: No behavioral change
The refactor MUST be purely structural; runtime behavior, outputs, and public APIs MUST remain identical before and after splitting.

#### Scenario: Behavior preserved
- **WHEN** the project is built and its test suite is run after the refactor
- **THEN** all existing tests pass and no public symbol names or signatures change

### Requirement: Quality gates pass after each split
After each file is split, lint, typecheck, and the relevant test suite MUST continue to pass.

#### Scenario: Verification after split
- **WHEN** a single file has been split and its barrel created
- **THEN** `lint`, `typecheck`, and the affected test suite (frontend Jest, backend vitest) succeed before proceeding to the next file

### Requirement: Barrels avoid circular imports
Extracted leaf modules MUST NOT import from the barrel that re-exports them.

#### Scenario: No circular dependency
- **WHEN** a leaf module is created under a split
- **THEN** it imports only from other leaf modules or shared utilities, never from its own barrel

### Requirement: Production bundle excludes debug tooling
The production build SHALL NOT include debug-only pages/routes (e.g. `/debug-favicons`, `/favicon-migration`). Debug tooling SHALL be excluded from the build output (conditional route generation or build-flag exclusion) rather than merely unlinked.

#### Scenario: Debug routes absent from production build
- **WHEN** `pnpm run build` completes a production build
- **THEN** no debug-route HTML/JS exists in `build/`

#### Scenario: Debug tooling remains available in development
- **WHEN** a developer runs the dev server with the debug flag enabled
- **THEN** the debug routes are reachable for development work

### Requirement: No dead code or unused dependencies
The repository SHALL NOT contain source files unreachable from any entry point (e.g. an unused `MainLayout` component), scripts that cannot execute as written, or production dependencies with zero imports. Removal SHALL be verified by a build plus full test run.

#### Scenario: Unused dependency removal keeps gates green
- **WHEN** the unused dependency `firebase` is removed and the build-time `fs-extra`/`cheerio` usage in `post-build.js` is replaced with `node:fs`/plain string APIs before their removal, and the CI gates run
- **THEN** lint, typecheck, tests, and the build all pass

### Requirement: Single source of truth for shared constants
Values consumed in more than one module (e.g. the API base URL) SHALL be defined exactly once and imported everywhere else. Duplicate literal definitions of such values SHALL fail review; a lint or test guard SHOULD detect reintroduction.

#### Scenario: API base URL defined once
- **WHEN** the backend URL must change
- **THEN** editing the single constant updates every consumer (extension store default and sync config)

### Requirement: Shared modules have a canonical home
Modules used by both the extension (`src/`) and the web frontend (`frontend/`) SHALL live in one shared workspace package imported by both. The frontend SHALL NOT reuse extension code via tsconfig path shadowing, and its dependency manifest SHALL NOT mirror the extension's dependency list.

#### Scenario: Shared module changes propagate to both consumers
- **WHEN** a shared module in the workspace package changes
- **THEN** both the extension build and the frontend build compile against the same single copy

### Requirement: One package manager
The repository SHALL use a single package manager (pnpm workspaces) across root, frontend, and backend; per-project foreign lockfiles SHALL be removed, and install/test/deploy scripts SHALL operate through the workspace.

#### Scenario: Single install command provisions everything
- **WHEN** a developer runs `pnpm install` at the repository root
- **THEN** root, frontend, and backend dependencies are installed consistently with one lockfile

