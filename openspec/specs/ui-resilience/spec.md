# ui-resilience Specification

## Purpose
Contain UI faults and keep state honest: per-region error boundaries with recovery isolate crashes, store-selector failures propagate instead of rendering fallback data, and state-linked resources (the bookmark mirror) are never mutated fire-and-forget from state updates.
## Requirements
### Requirement: Regional error boundaries with recovery
Major UI regions (left sidebar, main content, right panel, modals) SHALL each be wrapped in an error boundary that isolates a crash to its region and offers a Reset action that remounts the region. A crash in one region MUST NOT blank the entire application, and the root boundary SHALL remain as a last resort.

#### Scenario: Panel crash is contained
- **WHEN** a component inside the right panel throws during render
- **THEN** the right panel shows its error state with a Reset action and the rest of the application remains interactive

#### Scenario: Reset recovers the region
- **WHEN** the user activates Reset on an errored region
- **THEN** the region remounts and renders normally if the underlying issue was transient

### Requirement: Selector failures are honest
Store selector helpers SHALL NOT catch and swallow selector exceptions with fallback values. A throwing selector SHALL propagate to the nearest error boundary (surfacing the bug), not silently render wrong data with a console warning.

#### Scenario: Throwing selector surfaces as an error boundary state
- **WHEN** a selector throws during a render
- **THEN** the enclosing error boundary captures it instead of a fallback value being rendered silently

### Requirement: No detached async mutations of state-linked resources
Store actions that modify external resources tied to state (e.g. bookmark create/delete mirroring a link move) SHALL be sequenced with the state change and handle failure explicitly (rollback or a durable retry marker). Fire-and-forget promises inside state updaters MUST NOT leave state and external resources permanently divergent.

#### Scenario: Bookmark mirror failure is handled
- **WHEN** the bookmark write for a link move fails
- **THEN** the action either rolls back the move or records a retry marker — the link's stored `bookmarkId` never silently refers to the wrong bookmark

