## 1. Backend lib splits (highest risk, do first)

- [x] 1.1 Split `backend/src/lib/sync.ts` (1494): extract `prepareInsert*` helpers + parse helpers into `sync/prepare.ts`, keep `syncProject`/`describeMoveFanOut`/types in barrel `sync.ts`
- [x] 1.2 Split `backend/src/lib/projects.ts` (950): extract `membership.ts`, `invitations.ts`, `crud.ts` (incl. snapshot/activity), re-export from `projects.ts`
- [x] 1.3 Split `backend/src/lib/auth.ts` (468): extract `jwt.ts` (sign/verify/parse) from `login.ts` (request/verify code), re-export from `auth.ts`
- [x] 1.4 Run backend typecheck + tests (`pnpm typecheck` / `tsc --noEmit` and `vitest run`) after each split

## 2. Frontend store action splits

- [ ] 2.1 Split `src/stores/actions/taskActions.ts` (1262): extract `utils.ts` (generateId/timestamp/defaults/activity/author), `stats.ts` (`calculateTaskStats`); keep factory + `initializeTaskState` as barrel
- [ ] 2.2 Split `src/stores/actions/collectionActions.ts` (428): extract `buildCollectionUpdatePatch`, `syncCollectionOrders` into `collectionActions/` helpers
- [ ] 2.3 Split `src/stores/appStore.ts` (401): extract `mergeAppState` into `stores/mergeAppState.ts`, re-export

## 3. cloudflareSync module split

- [ ] 3.1 Split `src/lib/cloudflareSync/applyChanges.ts` (1053): extract per-entity files `apply/projects.ts`, `collections.ts`, `links.ts`, `notes.ts`, `todos.ts`, `tasks.ts`, `conflicts.ts`; keep `applyRemoteChanges`/`applyChange` + types as barrel
- [ ] 3.2 Split `cloudflareSync/__tests__/applyChanges.test.ts` (628) and `reconcile.test.ts` (622) and `entitySyncActions.test.ts` (751) into `cases/*.test.ts`
- [ ] 3.3 Run Jest `cloudflareSync` suite after split

## 4. UI component splits

- [ ] 4.1 Split `src/components/ui/sidebar.tsx` (770): extract primitives into `sidebar/` (provider, rail, menu, menu-button, menu-sub, etc.), re-export from `sidebar.tsx`
- [ ] 4.2 Split `src/components/right-panel/panels/TaskKanbanView.tsx` (615): extract `kanban/KanbanTaskCard.tsx`, `SortableTaskCard.tsx`, `KanbanColumn.tsx`, `kanban-config.ts`
- [ ] 4.3 Split `src/components/cloud-sync/ProjectCollaborationModal.tsx` (624): extract `collaboration/MembersTab.tsx`, `ActivityTab.tsx`, presentational helpers
- [ ] 4.4 Split `src/components/modals/TaskDetailModal.tsx` (617): extract `task-detail/MetadataItem.tsx`, `priorityConfig.ts`, section sub-components
- [ ] 4.5 Split `src/components/right-panel/panels/TaskAnalyticsDashboard.tsx` (675): extract `analytics/format.ts`, `analytics/theme.ts`, chart sections
- [ ] 4.6 Split `src/components/views/NotesView.tsx` (427): extract `NoteCard.tsx`, `note-config.ts`

## 5. Hooks and lib service splits

- [ ] 5.1 Split `src/hooks/useDragAndDrop.ts` (508): extract sub-hooks into `useDragAndDrop/` (drag state, draggable item, droppable zone) + types
- [ ] 5.2 Split `src/lib/importExport/importProject.ts` (392) and `exportProject.ts` (378): extract shared helpers where natural
- [ ] 5.3 Split `src/lib/tabService.ts` (386), `tabSessionService.ts` (332), `faviconMigration.ts` (306): extract helper functions into sibling modules
- [ ] 5.4 Split `src/lib/__tests__/bookmarkSyncService.test.ts` (420) into `cases/*.test.ts`

## 6. Verification

- [ ] 6.1 Run `pnpm lint` across the repo and fix any issues
- [ ] 6.2 Run typecheck (`tsc --noEmit` / `pnpm typecheck`) and confirm no errors
- [ ] 6.3 Run full test suite (frontend Jest + backend `vitest run`) and confirm all tests pass
- [ ] 6.4 Run `pnpm build` and confirm `out`/`build` generate successfully
- [ ] 6.5 Confirm no source file under `src/` or `backend/src/lib/` exceeds 400 lines post-refactor
- [ ] 6.6 Split `backend/src/lib/__tests__/sync.softdelete.test.ts` (427) into `cases/*.test.ts`
