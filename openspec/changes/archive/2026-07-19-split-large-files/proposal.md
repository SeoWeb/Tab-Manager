## Why

Several source files have grown beyond 400 lines and combine distinct, separable concerns (e.g. `taskActions.ts` at 1262 lines, `applyChanges.ts` at 1053, `backend/src/lib/sync.ts` at 1494). Large files hurt readability, increase merge conflicts, slow review, and make it harder to locate logic. Splitting them into cohesive smaller modules improves maintainability without changing runtime behavior.

## What Changes

- Split every source file over 400 lines into smaller, cohesive modules using a barrel/re-export pattern so existing import sites are unaffected.
- Extract per-entity handlers in `cloudflareSync/applyChanges.ts` into per-entity files.
- Extract store action helpers and stats out of `taskActions.ts`.
- Extract shadcn sidebar primitives from `sidebar.tsx` into a `sidebar/` directory.
- Extract tabs, cards, and helper components out of the large dashboard/modal/kanban panel components.
- Extract `prepareInsert*` and mutation logic out of `backend/src/lib/sync.ts`.
- Extract membership, invitation, and CRUD logic out of `backend/src/lib/projects.ts`.
- Split oversized test files into per-case test files.
- Re-export all extracted symbols from their original file paths (no behavioral change, **non-breaking** to callers).

## Capabilities

### New Capabilities
- `code-organization`: Modular file structure where large (>400 line) source files are split into cohesive sub-modules with re-exported barrels, preserving all existing public APIs.

### Modified Capabilities
<!-- No requirement-level behavior changes; purely structural refactor. -->

## Impact

- **Frontend source** (`src/`): `stores/actions/taskActions.ts`, `stores/actions/collectionActions.ts`, `stores/appStore.ts`, `lib/cloudflareSync/applyChanges.ts` (+tests), `components/ui/sidebar.tsx`, `components/right-panel/panels/*`, `components/cloud-sync/ProjectCollaborationModal.tsx`, `components/modals/*`, `components/views/NotesView.tsx`, `hooks/useDragAndDrop.ts`, `lib/importExport/*`, `lib/tabService.ts`, `lib/tabSessionService.ts`, `lib/faviconMigration.ts`.
- **Backend source** (`backend/src/lib/`): `sync.ts`, `projects.ts`, `auth.ts`.
- **Tests**: `cloudflareSync/__tests__/*`, `lib/__tests__/bookmarkSyncService.test.ts`.
- **Build/tooling**: No dependency additions. `package.json` scripts (lint, typecheck, build, test) must continue to pass.
- **Risk**: Low — structural only. Main risk is broken re-exports; mitigated by re-exporting from original paths and running lint + typecheck + build + tests (frontend Jest, backend vitest) after each split.
