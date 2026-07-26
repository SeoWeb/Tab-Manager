## Context

The extension codebase has accumulated several oversized source files (frontend `src/` and backend `backend/src/lib/`). The full list of files exceeding 400 lines:

**Frontend (`src/`)**
- `stores/actions/taskActions.ts` (1262) — single file holding utilities, stats, and a large `createTaskActions` factory.
- `lib/cloudflareSync/applyChanges.ts` (1053) — already sectioned by entity (Projects, Collections, Links, Notes, Todos, Tasks) with `apply*`, `build*`, `merge*` handlers.
- `components/ui/sidebar.tsx` (770) — shadcn-style collection of sidebar primitives.
- `components/right-panel/panels/TaskAnalyticsDashboard.tsx` (675)
- `components/cloud-sync/ProjectCollaborationModal.tsx` (624)
- `components/modals/TaskDetailModal.tsx` (617)
- `components/right-panel/panels/TaskKanbanView.tsx` (615)
- `hooks/useDragAndDrop.ts` (508)
- `stores/actions/collectionActions.ts` (428), `components/views/NotesView.tsx` (427), `stores/appStore.ts` (401), `lib/importExport/{importProject,exportProject}.ts`, `lib/tabService.ts`, `lib/tabSessionService.ts`, `lib/faviconMigration.ts`.
- Test files: `cloudflareSync/__tests__/entitySyncActions.test.ts` (751), `applyChanges.test.ts` (628), `reconcile.test.ts` (622), `lib/__tests__/bookmarkSyncService.test.ts` (420).

**Backend (`backend/src/lib/`)**
- `sync.ts` (1494) — `syncProject`, mutation application, and many `prepareInsert*` helpers.
- `projects.ts` (950) — membership, invitations, CRUD, snapshot.
- `auth.ts` (468) — JWT + login-code flow.

Constraints: no new runtime dependencies, must keep all public import paths working, all existing `package.json` scripts must pass (frontend: lint, typecheck, build, Jest; backend: typecheck, `vitest run`).

## Goals / Non-Goals

**Goals:**
- Reduce every listed file to under ~400 lines by extracting cohesive units into smaller sibling modules.
- Preserve all existing public APIs and import paths via re-export barrels.
- Keep the change purely structural — zero behavioral change.

**Non-Goals:**
- No logic rewrite, bug fixes, or feature additions.
- No new dependencies or build-tool changes.
- No renaming of public symbols (beyond internal-only helpers).
- No changes to `out/`, `build/`, `dist/`, or `.next/` (generated artifacts).

## Decisions

1. **Barrel re-export pattern** — Each split original file becomes a thin barrel that re-exports the extracted symbols. Rationale: keeps every existing import site (e.g. `import { createTaskActions } from '.../taskActions'`) working with no edits to callers. Alternative considered: updating all import sites — rejected as high-churn and error-prone.

2. **Split by existing section boundaries** — Use the comments/markers already present in files (e.g. `applyChanges.ts` entity sections, modal tab sections) as the natural extraction seams. Rationale: minimal risk, clear ownership.

3. **Directory-per-component for UI** — For `sidebar.tsx`, `TaskKanbanView.tsx`, `ProjectCollaborationModal.tsx`, extract into a co-located sub-directory (`sidebar/`, `kanban/`, `collaboration/`) with one file per component/tab, re-exported from the original filename.

4. **Backend: group by concern** — `sync.ts` → `prepareInsert*` + parse helpers into `sync/prepare.ts`; `projects.ts` → `membership.ts`, `invitations.ts`, `crud.ts`. Keep the original file as a barrel.

5. **Tests split by describe-block** — Move each top-level `describe` into `cases/*.test.ts` under the same `__tests__` dir, re-exporting or simply leaving multiple files (the test runner auto-discovers `*.test.ts`: Jest on the frontend, vitest on the backend).

## Risks / Trade-offs

- [Risk] Broken/missing re-exports causing compile or runtime import errors. → Mitigation: re-export every moved symbol from the original path; run `typecheck` + `lint` immediately after each file split before moving on.
- [Risk] Circular imports when introducing barrels. → Mitigation: keep barrels one-directional (leaf modules → barrel); avoid re-importing barrel from leaves.
- [Risk] Test discovery/duplication when splitting test files. → Mitigation: confirm the test config globs all `__tests__/**/*.test.ts` (frontend `jest.config.js`, backend vitest defaults); ensure no duplicate suite names across split files.
- [Trade-off] More files = more navigation overhead, but each file is focused and far easier to review.

## Migration Plan

- Implement file-by-file. After each split: run `pnpm lint`, `pnpm typecheck` (or `tsc --noEmit`), and the affected tests (frontend Jest, backend `vitest run`).
- No deployment step beyond the existing build; generated `out/`/`build/` are produced by `pnpm build`.
- Rollback: each split is independent and git-tracked; revert individual commits if a split introduces issues.

## Open Questions

- None blocking. Optional: whether `auth.ts` split is worth it at 468 lines (kept as LOW priority).
