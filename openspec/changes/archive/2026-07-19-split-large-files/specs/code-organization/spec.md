## ADDED Requirements

### Requirement: Large source files are split into cohesive modules
Any source file in `src/` or `backend/src/lib/` that exceeds 400 lines SHALL be split into smaller, cohesive modules so that no resulting source file exceeds ~400 lines.

#### Scenario: File exceeds threshold
- **WHEN** a source file has more than 400 lines
- **THEN** its distinct concerns are extracted into separate sibling files or a co-located sub-directory

### Requirement: Original import paths remain valid
After extraction, every symbol previously exported from the original file path MUST continue to be importable from that same path.

#### Scenario: Consumer imports unchanged
- **WHEN** existing code imports a symbol from the original file path
- **THEN** the import resolves without modification because the original file re-exports the extracted symbols

### Requirement: No behavioral change
The refactor MUST be purely structural; runtime behavior, outputs, and public APIs MUST remain identical before and after splitting.

#### Scenario: Behavior preserved
- **WHEN** the project is built and its test suite is run after the refactor
- **THEN** all existing tests pass and no public symbol names or signatures change

### Requirement: Quality gates pass after each split
After each file is split, lint, typecheck, and the relevant test suite MUST continue to pass.

#### Scenario: Verification after split
- **WHEN** a single file has been split and its barrel created
- **THEN** `lint`, `typecheck`, and the affected test suite (frontend Jest, backend vitest) succeed before proceeding to the next file

### Requirement: Barrels avoid circular imports
Extracted leaf modules MUST NOT import from the barrel that re-exports them.

#### Scenario: No circular dependency
- **WHEN** a leaf module is created under a split
- **THEN** it imports only from other leaf modules or shared utilities, never from its own barrel
