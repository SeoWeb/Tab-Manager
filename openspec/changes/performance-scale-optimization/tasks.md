## 1. Setup

- [x] 1.1 Add `@tanstack/react-virtual` dependency (`pnpm add @tanstack/react-virtual`)
- [x] 1.2 Create a reusable virtualized scroll-container hook/util in `src/lib` (wraps `useVirtualizer`, enables `autoScroll` + `measuring` for dnd-kit)

## 2. Fix Zustand selectors (memoization prerequisite)

- [x] 2.1 Replace the object-returning selector in `LinkItem.tsx:34` with `useShallow` (split `deleteLink`/`openEditLinkModal`/`searchQuery`)
- [x] 2.2 Grep `src` for other `useAppStore((state) => ({...}))` / `useAppStoreWithDefaults((state) => ({...}))` object selectors and convert them to `useShallow` or primitive selectors

## 3. Memoize list item components

- [x] 3.1 Wrap `ProjectItem`, `SortableProjectItem`, `SortableCollectionItem`, `DragEnabledCollection`, `SortableLinkItem`, `LinkItem` in `React.memo`
- [x] 3.2 `useMemo` the `sortedProjects` (ProjectList) and `sortedCollections` (DragEnabledCollectionsList) arrays so internal `handleNavigation` stays referentially stable

## 4. Virtualize lists

- [x] 4.1 Virtualize the sidebar projects list in `ProjectList.tsx` (scroll container + `useVirtualizer`, keep full `<SortableContext items={allIds}>`, render only visible rows)
- [x] 4.2 Virtualize the collections list in `DragEnabledCollectionsList.tsx` with the same pattern
- [x] 4.3 Convert `DragEnabledCollection` link grid from `flex flex-wrap` to a fixed-column grid; compute column count from measured container width and apply row-based `useVirtualizer`; keep per-link `SortableLinkItem` + external tab/bookmark drop placeholders

## 5. Lazy-load heavy components

- [x] 5.1 Wrap the four modals in `AppClient.tsx` (`AddProjectModal`, `AddCollectionModal`, `AddLinkModal`, `EditLinkModal`) with `React.lazy` + `<Suspense fallback={<Skeleton/>}>`
- [x] 5.2 Lazy-load `EditCollectionModal`/`EditProjectModal` and the right-panel views (`TasksView`, `NotesView`, `TodosView`, `SettingsView`, Kanban, Analytics) and `RightContentPanel` content with `React.lazy` + `<Suspense>`

## 6. Loading skeletons & states

- [x] 6.1 Add `Skeleton` fallbacks to all new `<Suspense>` boundaries
- [x] 6.2 Add `Skeleton` placeholders for large/empty lists during initial store hydration (`_hasHydrated`)

## 7. Verify & close out

- [ ] 7.1 Extend `mockData.ts` to generate 100+ projects/collections/links for manual testing
- [ ] 7.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm build` and fix failures
- [ ] 7.3 Manually verify scroll perf + drag/drop with large data, then mark the 5 Phase 7 `TODO.md` items `[x]`
