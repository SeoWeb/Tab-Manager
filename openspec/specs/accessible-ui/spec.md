# accessible-ui Specification

## Purpose
Make the UI usable by everyone and resilient across sessions: every interactive control that conveys its purpose only through an icon carries an accessible name, with lint enforcement preventing regressions, and user-facing view preferences survive restarts like the rest of persisted state.
## Requirements
### Requirement: Accessible names for icon-only controls
Every interactive control that conveys its purpose only through an icon SHALL have an accessible name (`aria-label` or equivalent). The starting scope is `TabSessionsPanel`'s icon-only buttons; the codebase-wide rule applies to all new icon-only controls.

#### Scenario: Icon-only buttons are named
- **WHEN** a screen reader traverses `TabSessionsPanel`
- **THEN** every icon-only button announces a meaningful name

#### Scenario: Lint guards the rule going forward
- **WHEN** a new icon-only button without an accessible name is introduced
- **THEN** the ESLint jsx-a11y rule fails lint

### Requirement: UI preferences persist
User-facing view preferences — link `sortOption` and `searchFilters` — SHALL be included in the persisted state like other UI preferences, surviving restarts.

#### Scenario: Sort choice survives restart
- **WHEN** the user changes the link sort option and restarts the browser
- **THEN** the chosen sort option is still active

