## ADDED Requirements

### Requirement: List item components SHALL be memoized

The list item components (`ProjectItem`, `SortableProjectItem`, `SortableCollectionItem`, `DragEnabledCollection`, `SortableLinkItem`, `LinkItem`) SHALL be wrapped in `React.memo` so they skip re-rendering when their entity prop reference is unchanged.

#### Scenario: Unrelated state change

- **WHEN** an unrelated piece of state changes (e.g. active project id, search query)
- **THEN** list item components whose `project`/`collection`/`link` prop reference is unchanged SHALL NOT re-render

### Requirement: Zustand selectors SHALL return stable references

Object-returning `useAppStore`/`useAppStoreWithDefaults` selectors SHALL use `useShallow` (or individual primitive selectors) so they do not allocate a new object on every render.

#### Scenario: Object selector stability

- **WHEN** a component selects multiple fields via a single object-returning selector (e.g. `LinkItem.tsx`)
- **THEN** the selector returns a referentially stable result for unchanged fields and SHALL NOT trigger the React "getSnapshot should be cached" warning
