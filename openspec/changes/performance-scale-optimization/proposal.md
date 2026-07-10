## Why

The TabSpace extension's TODO.md leaves the Phase 7 "Performance Optimization" items unchecked, and the code confirms it: no component memoization, no list virtualization, and all modals/right-panel views are eagerly imported. At 100+ projects/collections (and the many links inside them) the sidebar, collections list, and link grid mount every row's DOM nodes at once, and any state change (active project, search, drag) re-renders the entire tree. This makes the new-tab page lag badly at scale.

## What Changes

- Add `@tanstack/react-virtual` and virtualize the three largest rendering surfaces: the sidebar projects list, the collections list, and the link grid inside each collection.
- Wrap list item components (`ProjectItem`, `SortableProjectItem`, `SortableCollectionItem`, `DragEnabledCollection`, `SortableLinkItem`, `LinkItem`) in `React.memo` so unrelated state changes no longer re-render every row.
- Fix Zustand selector anti-patterns (notably `LinkItem.tsx` returning a new object from `useAppStore`) using `useShallow` / individual primitive selectors to stop forced re-renders and "getSnapshot should be cached" warnings.
- Lazy-load heavy components via `React.lazy` + `<Suspense>`: the four modals rendered in `AppClient.tsx`, plus the right-panel views (Tasks, Notes, Todos, Settings, Kanban, Analytics) and `RightContentPanel` content.
- Add `Skeleton`-based loading states for the new Suspense boundaries and for large/empty lists during initial hydration.

## Capabilities

### New Capabilities
- `list-virtualization`: Windowing of the sidebar projects list, the collections list, and the in-collection link grid so only visible rows are mounted; integrates with the existing `@dnd-kit` sortable/drop behavior.
- `render-memoization`: `React.memo` wrapping of list item components and corrected Zustand selectors (`useShallow`) to minimize re-renders at scale.
- `lazy-loading`: Deferred code-loading of modals and heavy right-panel views with `<Suspense>` boundaries.
- `loading-skeletons`: `Skeleton` fallback states for lazy chunks and large/empty lists.

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Dependencies**: adds `@tanstack/react-virtual`.
- **Code**: `src/components/left-sidebar/ProjectList.tsx`, `ProjectItem.tsx`; `src/components/main-content/DragEnabledCollectionsList.tsx`, `LinkItem.tsx`; `src/components/drag-drop/SortableProjectItem.tsx`, `SortableCollectionItem.tsx`, `SortableLinkItem.tsx`, `DragEnabledCollection.tsx`; `src/components/AppClient.tsx` (modal/panel lazy loading + Suspense); `src/stores/*` and `useAppStoreWithDefaults.ts` (selector fixes).
- **Behavior**: link grid layout converts from `flex flex-wrap` to a fixed-column grid to enable row virtualization (visual change, same content). Drag-and-drop remains functional but a dragged item scrolled fully out of view may lose its node mid-drag (acceptable edge case).
- **Docs**: Phase 7 checklist items in `TODO.md` marked `[x]`.
