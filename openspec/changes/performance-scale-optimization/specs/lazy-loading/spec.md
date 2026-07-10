## ADDED Requirements

### Requirement: Modals SHALL be lazy-loaded
The modals rendered by `AppClient` (`AddProjectModal`, `AddCollectionModal`, `AddLinkModal`, `EditLinkModal`, and the edit modals for collection/project) SHALL be loaded via `React.lazy` and wrapped in a `<Suspense>` boundary with a `Skeleton` fallback.

#### Scenario: Initial app load
- **WHEN** the extension first renders
- **THEN** modal component code is not part of the initial critical bundle and loads on demand

#### Scenario: Modal open
- **WHEN** a lazy modal is opened for the first time
- **THEN** a `Skeleton` fallback is shown until the chunk resolves, then the modal renders

### Requirement: Right-panel views SHALL be lazy-loaded
The heavy right-panel views (`TasksView`, `NotesView`, `TodosView`, `SettingsView`, Kanban, Analytics) and `RightContentPanel` content SHALL be loaded via `React.lazy` with a `<Suspense>` `Skeleton` fallback.

#### Scenario: Switching to a heavy view
- **WHEN** the user opens the tasks/notes/todos/settings panel for the first time
- **THEN** its code loads on demand behind a `Skeleton` fallback rather than at initial mount
