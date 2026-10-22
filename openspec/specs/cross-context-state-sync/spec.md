# cross-context-state-sync Specification

## Purpose
TBD - created by archiving change fix-cross-context-data-loss. Update Purpose after archive.
## Requirements
### Requirement: Generation-checked writes
The persisted state blob SHALL carry a monotonically increasing `stateGeneration` counter. Before persisting, a context SHALL re-read the stored generation and, if it changed since the context's last read, SHALL merge its pending changes with the freshly stored state instead of overwriting it. The generation SHALL be incremented by every successful persist.

#### Scenario: Concurrent edits from popup and newtab both survive
- **WHEN** a newtab persists state after the popup has persisted a different, newer snapshot
- **THEN** the newtab detects the changed generation, merges (per the merge rules below), and both contexts' edits are present in storage

#### Scenario: Generation increments on every persist
- **WHEN** any context successfully persists state
- **THEN** the stored `stateGeneration` is strictly greater than before the write

### Requirement: Change-notification rehydration with merge semantics
Every context SHALL subscribe to `chrome.storage.onChanged` for the state key and rehydrate when another context persists. Rehydration SHALL merge persisted entities into the current state by entity `id`, preferring the copy with the newer `updatedAt` (tie-break: persisted copy wins only when the local copy has no unsynced local edit), and SHALL NOT replace arrays wholesale or remove locally-created entities that are absent from the persisted snapshot.

#### Scenario: Background pull does not revert in-flight popup edits
- **WHEN** a rehydrate runs while the user is editing a note in the popup
- **THEN** fields the popup changed more recently than the persisted snapshot retain their local values

#### Scenario: Locally-created entity survives rehydrate
- **WHEN** the user creates a link locally and a rehydrate arrives from a snapshot that predates the creation
- **THEN** the link still exists after rehydration

#### Scenario: Non-cloud users get cross-context consistency
- **WHEN** two contexts exchange edits with cloud sync disabled
- **THEN** the change-notification rehydration still merges both contexts' edits (no dependency on cloud-sync timestamps)

### Requirement: Single owner for tab-session auto-save
Tab-session auto-save (open-tab change monitoring and periodic snapshotting of `current_tab_session`) and session-restore eligibility checks SHALL run only in the background service worker. Page contexts (popup, newtab) SHALL request a save via message instead of writing session storage themselves, so exactly one writer exists for the session key.

#### Scenario: Two open contexts produce one auto-saver
- **WHEN** a newtab and the popup are open simultaneously
- **THEN** only the background worker registers tab-listeners and the periodic session save

#### Scenario: Popup-triggered save is delegated
- **WHEN** the popup needs the current session saved
- **THEN** it sends a message to the background worker, which performs the single write

### Requirement: Persistence failures never overwrite data
If computing the persistable snapshot (`partialize`) throws, the persist SHALL be skipped (and the error logged) rather than writing an empty or partial snapshot over stored data. The storage layer SHALL also validate a read snapshot before replacing current state, and reject structurally invalid snapshots.

#### Scenario: partialize error skips the write
- **WHEN** an exception occurs while serializing state for persistence
- **THEN** previously stored data remains intact and unchanged

#### Scenario: Invalid stored snapshot is rejected
- **WHEN** the stored blob fails structural validation on load
- **THEN** it is quarantined (renamed/copied aside) and the context reports the corruption instead of silently wiping user data

### Requirement: Hydration gate blocks on storage load
UI rendering SHALL wait until the async storage load completes (or definitively fails) before replacing initial state, and the initial/default state SHALL be deterministic (fixed default IDs, no module-load randomness), so contexts never render mock data as a flash of wrong content nor start with differing default IDs.

#### Scenario: No mock-data flash
- **WHEN** a newtab opens with existing persisted data
- **THEN** the UI does not render default/mock projects before the persisted state appears

#### Scenario: Deterministic defaults
- **WHEN** two contexts initialize with no persisted data
- **THEN** their default state (including IDs) is identical

