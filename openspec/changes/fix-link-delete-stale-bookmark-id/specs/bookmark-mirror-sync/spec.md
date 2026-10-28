# Spec Delta

## ADDED Requirements

### Requirement: Link deletion is idempotent

Deleting a TabSpace link SHALL remove its mirrored Chrome bookmark when it exists, and SHALL succeed silently when the mirrored bookmark no longer exists in the local bookmark tree. A missing bookmark MUST NOT be surfaced to the user as an error. The same idempotency SHALL apply to deleting a collection of mirrored bookmarks (tree deletion): a root that is already gone is treated as already-deleted, not as a failure.

#### Scenario: Mirror bookmark already vanished

- **WHEN** the user deletes a link whose stored bookmark id no longer exists in the Chrome bookmark tree
- **THEN** the link is removed from TabSpace state and no error toast is shown

#### Scenario: Orphan cleanup targets a vanished bookmark

- **WHEN** link sync detects a stored bookmark id is missing and cleans up the orphaned link by deleting it
- **THEN** the deletion succeeds silently and no error toast is shown

#### Scenario: Mirror bookmark still exists

- **WHEN** the user deletes a link whose mirrored bookmark still exists in the Chrome bookmark tree
- **THEN** the bookmark is removed and the link is deleted as before

#### Scenario: Tree root already gone

- **WHEN** a mirrored bookmark tree (collection root) is deleted and the root folder is already absent from the Chrome bookmark tree
- **THEN** the operation is treated as already-deleted and completes without an error toast

### Requirement: Device-local bookmark ids are never overwritten by pull or import

The cloud sync pull path and the import path SHALL NOT write bookmark ids into local link state. Bookmark ids are device-local: a value originating from another device (a pulled patch or an imported export file) MUST NOT overwrite this device's stored bookmark id. Pulled link data SHALL leave the local bookmark id untouched when a local link already exists, and SHALL set it to empty when creating a link; imports SHALL drop any bookmark id carried by the export so the mirror is re-established from this device's bookmark tree.

#### Scenario: Pull from another device preserves the local bookmark id

- **WHEN** a cloud sync pull applies a link patch that originated on another device onto an existing local link
- **THEN** the local link's stored bookmark id is unchanged

#### Scenario: Pull creates a link without a bookmark id

- **WHEN** a cloud sync pull creates a new local link from pulled data
- **THEN** the created link has no bookmark id until this device's own mirror logic assigns one

#### Scenario: Imported bookmark id is dropped

- **WHEN** the user imports an export file whose links carry bookmark ids from the exporting device
- **THEN** the imported links are stored without those bookmark ids and the mirror is re-established by this device's bookmark sync

### Requirement: Mirror move and delete operations are serialized per link

Bookmark mirror operations affecting the same link (moves of the mirrored bookmark and removals of the mirrored bookmark) SHALL be executed one at a time per link, in submission order, so overlapping operations cannot attempt to remove the same bookmark id twice. The local store update for a link deletion SHALL remain immediate and MUST NOT wait on the bookmark mirror work.

#### Scenario: Overlapping move and delete do not double-remove

- **WHEN** a cross-collection move of a link and a deletion of that link overlap in time
- **THEN** the mirrored bookmark operations run sequentially per link and the bookmark id is removed at most once

#### Scenario: Store deletion is not blocked by mirror work

- **WHEN** the user deletes a link and the mirrored bookmark removal is queued behind another operation for that link
- **THEN** the link disappears from the UI immediately while the mirror removal completes afterwards
