## ADDED Requirements

### Requirement: Lazy boundaries SHALL show skeleton fallbacks

Every `<Suspense>` boundary introduced for lazy modals and right-panel views SHALL use the existing `Skeleton` component as its fallback.

#### Scenario: Chunk pending

- **WHEN** a lazy component's code chunk is still loading
- **THEN** a `Skeleton` placeholder is displayed in its place

### Requirement: Large and empty lists SHALL show loading skeletons

The application SHALL render `Skeleton` placeholders for large lists during initial store hydration and for empty large-list states where appropriate.

#### Scenario: Pre-hydration

- **WHEN** the app renders before the Zustand store has hydrated from `chrome.storage`
- **THEN** list areas show `Skeleton` placeholders instead of flashing empty content
