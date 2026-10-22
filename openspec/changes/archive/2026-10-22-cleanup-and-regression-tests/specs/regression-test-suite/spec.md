## ADDED Requirements

### Requirement: Multi-context storage regression tests
The test suite SHALL include a chrome.storage simulator that models atomic key get/set, `onChanged` notification, and the absence of transactions, and SHALL use it to run two store contexts against one storage with interleaved writes, asserting the generation-checked merge behavior (both contexts' edits survive; rehydrate does not revert newer local edits; locally-created entities survive).

#### Scenario: Interleaved writes converge
- **WHEN** two simulated contexts persist overlapping state with different edits
- **THEN** the final stored state contains both edits and no context's write silently overwrites the other's

#### Scenario: Rehydrate preserves newer local edits
- **WHEN** a rehydrate event fires while a context holds newer edits than the stored snapshot
- **THEN** the test asserts the newer local field values are retained

### Requirement: Real-D1 backend integration tests
Backend tests SHALL include an integration suite running against a real D1 instance (miniflare / `@cloudflare/vitest-pool-workers`) covering: the IDOR matrix (editor of project A cannot read/mutate/move/delete project B entities), quota breach commit paths (no burned invitations, no phantom changelog, 403 not 500), invitation-accept and login-code concurrency races, and CAS version conflicts. These tests SHALL model FK constraints and batch semantics faithfully, replacing mocks that hide those behaviors.

#### Scenario: IDOR matrix fails closed
- **WHEN** the integration suite submits cross-project mutations for every entity type
- **THEN** all are rejected with no writes to the foreign project and correct per-mutation outcomes

#### Scenario: Quota breaches commit nothing
- **WHEN** create/accept operations hit their caps against real D1
- **THEN** no dependent rows exist and responses are structured 403s

#### Scenario: Login brute force is capped across races
- **WHEN** wrong codes are submitted concurrently beyond the attempt cap against real D1
- **THEN** no more than the cap is consumed and the code invalidates

### Requirement: Bookmark mirror regression tests
The test suite SHALL cover bookmark-event queueing (events during sync are drained, not dropped), debounce coalescing (N events → one sync), ID-only entity matching (duplicate folder names never cross-link), and non-destructive folder-disappearance handling (local data remains, marker set, re-link restores).

#### Scenario: Audit failure classes have regression coverage
- **WHEN** the bookmark suite runs
- **THEN** each of the four behaviors above is asserted by at least one test

### Requirement: Onboarding flow regression test
The test suite SHALL include a fresh-install flow test: no stored state → wizard opens; a store write without completing does not set the completion flag; relaunch shows the wizard again; an upgrading storage shape (no migration marker, existing projects) is skipped exactly once.

#### Scenario: Fresh user can complete onboarding
- **WHEN** the onboarding suite simulates a new user who writes state before finishing the wizard
- **THEN** the wizard re-opens on the next launch and completing it sets the explicit flag
