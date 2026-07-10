## Context

TabSpace is a Chrome new-tab extension built on Next.js (static export), React 18, Zustand 4.5, and `@dnd-kit` for drag-and-drop. The current UI renders the sidebar projects list, the main collections list, and each collection's link grid by mapping over the full array and mounting every row into the DOM. List item components are not memoized, and several Zustand selectors return fresh objects each render. With 100+ projects/collections and many links, this causes heavy initial mount cost and tree-wide re-renders on every state change.

## Goals / Non-Goals

**Goals:**

- Keep only visible rows mounted for the three large lists (projects, collections, links) via `@tanstack/react-virtual`.
- Stop unrelated re-renders with `React.memo` on list items and `useShallow` Zustand selectors.
- Defer modal and heavy right-panel view code with `React.lazy` + `<Suspense>`.
- Provide `Skeleton` loading states for lazy chunks and large/empty lists.

**Non-Goals:**

- No new user-facing features or UI rewrites beyond the link-grid layout change needed for virtualization.
- No backend / sync performance changes (out of scope for Phase 7 UI perf).
- No changes to persistence or data model.

## Decisions

- **Virtualization library: `@tanstack/react-virtual`** (over `react-window`). Headless, supports variable/estimated sizes, works with `@dnd-kit`, and supports Next static export. `react-window` is less flexible for variable-size + dnd integration.
- **Keep `<SortableContext>`/`items` = full id list; only DOM rows virtualized.** dnd-kit measures rendered sortable nodes; virtualization renders only visible ones. Enable `measuring` + `autoScroll` on the scroll container so dragging near edges scrolls and keeps the active item measured. Alternative (disabling dnd beyond a threshold) was rejected because the user requires reordering to keep working at scale.
- **Link grid becomes a fixed-column grid + row-based virtualizer.** Current `flex flex-wrap` cannot be virtualized (no stable row structure). Compute column count from the measured container width; virtualize rows. Each row still renders individual `SortableLinkItem`s so per-link drag/drop and external tab/bookmark drops keep working.
- **`useShallow` from `zustand/react/shallow`** for object-returning selectors (e.g. `LinkItem.tsx:34`), instead of custom equality fns. Avoids the new-object-every-render anti-pattern and the React "getSnapshot should be cached" warning.
- **Lazy load via `React.lazy`**, reusing the existing `lazyImport` pattern where convenient. Modals + right-panel views wrapped in `<Suspense fallback={<Skeleton/>}>`.

## Risks / Trade-offs

- **[Drag item scrolled out of view]** → A sortable node that scrolls fully out of the viewport during a drag loses its DOM node. Mitigation: keep `autoScroll` enabled and `measuring` configured; this is an acceptable edge case for long lists.
- **[Link grid visual change]** → Converting `flex flex-wrap` to a fixed grid changes wrapping behavior. Mitigation: verify layout/responsiveness after implementation; keep item width ~`w-64`.
- **[Virtualizer measurement jitter]** → Variable heights can cause scroll jumps. Mitigation: use `estimateSize` + `measureElement` and stable keys; memoize sorted arrays.
- **[Suspense + modals]** → Modals rendered in `AppClient` need `<Suspense>` boundaries. Mitigation: wrap each lazy modal in its own boundary with a `Skeleton` fallback so open latency stays invisible.

## Migration Plan

- Add dependency and implement behind existing components (no API/flag change).
- Verify with `pnpm typecheck && pnpm lint && pnpm build`; manually exercise 100+ projects/collections/links.
- Rollback: revert the change branch; no data migration needed.

## Open Questions

- None blocking; link-grid column-count strategy (CSS-driven vs JS-measured) to be finalized during implementation.
