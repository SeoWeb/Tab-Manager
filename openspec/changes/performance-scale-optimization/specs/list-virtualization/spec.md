## ADDED Requirements

### Requirement: Sidebar projects list SHALL be virtualized
The sidebar projects list SHALL render only the project rows currently visible within its scroll viewport using windowing, while still providing the full ordered id list to the drag-and-drop sortable context.

#### Scenario: Many projects mounted
- **WHEN** the store contains 100 or more projects
- **THEN** the DOM contains mounted nodes only for projects within (or near) the visible scroll area, not all 100

#### Scenario: Drag and drop stays functional
- **WHEN** a user reorders a visible project via drag
- **THEN** the sortable context receives the full project id list and reordering updates order as before

### Requirement: Collections list SHALL be virtualized
The main content collections list SHALL window its collection rows so only visible collections are mounted.

#### Scenario: Many collections in a project
- **WHEN** the active project contains 100 or more collections
- **THEN** only visible collection rows are mounted in the DOM

### Requirement: In-collection link grid SHALL be virtualized
Each collection's link grid SHALL use a fixed-column grid with row-based windowing so only visible link rows are mounted, preserving per-link drag/drop and external tab/bookmark drop behavior.

#### Scenario: Large link grid
- **WHEN** a collection contains 200 or more links
- **THEN** only the visible link rows are mounted in the DOM

#### Scenario: External item drop preserved
- **WHEN** a Chrome tab or bookmark is dragged onto a visible link row or drop placeholder
- **THEN** the add-link / duplicate-URL validation behavior is unchanged
