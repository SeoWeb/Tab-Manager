# bookmark-mirror-sync Specification

## Purpose
TBD - created by archiving change fix-cross-context-data-loss. Update Purpose after archive.
## Requirements
### Requirement: Bookmark events are queued, not dropped
Bookmark-change events arriving while a bookmark sync is in progress SHALL be queued and drained after the in-progress sync completes, rather than discarded. The queue SHALL be bounded (a cap with coalescing of per-id events) so a pathological event burst cannot grow without limit.

#### Scenario: Event during sync is applied afterwards
- **WHEN** a bookmark is created while a full bookmark sync is running
- **THEN** after the sync completes, the queued event is processed and the corresponding entity appears

#### Scenario: Burst is coalesced
- **WHEN** many events for the same bookmark id arrive during one sync
- **THEN** the queue keeps only the latest state for that id

### Requirement: Feedback-loop suppression is exception-safe
While the extension is applying its own bookmark writes, bookmark-change events SHALL be suppressed using a flag managed with try/finally (or equivalent guaranteed restore) around the write operation. The flag MUST NOT be restored on a timer.

#### Scenario: No spurious sync after an extension write
- **WHEN** the extension creates a bookmark folder as part of mirroring and Chrome echoes the change
- **THEN** the echo is suppressed exactly for the duration of the write and no self-triggered full sync follows

#### Scenario: Failure restores the flag
- **WHEN** a bookmark write throws mid-operation
- **THEN** the suppression flag is restored by the finally block and subsequent user bookmark events are processed

### Requirement: Mirror sync is debounced with a trailing run
Rapid bookmark changes SHALL be debounced into a single partial sync that runs once after the changes settle (trailing-edge), regardless of how many individual events occurred.

#### Scenario: N rapid events cause one sync
- **WHEN** 20 bookmark events arrive within the debounce window
- **THEN** exactly one partial sync runs after the window closes

### Requirement: Entity matching uses bookmark folder IDs only
Matching between TabSpace projects/collections and bookmark folders SHALL use stored `bookmarkFolderId` references only. Display names MUST NOT be used to associate folders with entities. A folder whose ID is not referenced by any entity SHALL be reported/ignored, never auto-adopted by name.

#### Scenario: Duplicate folder names do not cross-link
- **WHEN** two bookmark folders share a title and a new project is created for one of them
- **THEN** only the folder created for (and referenced by ID from) that project is treated as its mirror

### Requirement: Deleted folders do not destroy local data
When a mirrored bookmark folder is missing from the Chrome bookmark tree, the corresponding local project/collection SHALL be marked as unmapped (mirror link cleared) and surfaced in the UI for the user to restore or confirm deletion — local entities SHALL NOT be deleted automatically. A re-created folder with the stored ID restores the mapping.

#### Scenario: Folder deletion leaves the project intact
- **WHEN** the user deletes a project's bookmark folder in Chrome
- **THEN** the project and its collections/links remain in TabSpace, marked as "bookmark mirror removed"

#### Scenario: Re-creating the folder restores the mirror
- **WHEN** a folder with the same stored ID appears again
- **THEN** the mapping is restored and the marker cleared

### Requirement: Listener lifecycle is correct
Bookmark event listeners SHALL be registered with stable references and removable: teardown MUST be able to actually remove previously registered listeners (no `.bind()`-created throwaway references in removal calls).

#### Scenario: Teardown removes listeners
- **WHEN** the bookmark sync service is destroyed and re-created (e.g. in tests or a background restart path)
- **THEN** the old listeners are removed and events are handled exactly once

