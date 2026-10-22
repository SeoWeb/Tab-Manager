# change-log-retention Specification

## Purpose
TBD - created by archiving change scale-sync-backend. Update Purpose after archive.
## Requirements
### Requirement: Change-log retention limits
The system SHALL prune `sync_changes` rows per project when they exceed a time limit (default 90 days) or a per-project count cap (default 50,000), whichever triggers first. Pruning SHALL delete oldest rows first and SHALL run on a schedule (D1/alarm-based), not only on-demand. Limits SHALL be overridable via environment variables with the documented defaults.

#### Scenario: Old rows are pruned on schedule
- **WHEN** the pruning run executes and a project has change-log rows older than the retention window
- **THEN** those rows are deleted and newer rows are retained

#### Scenario: Count cap bounds growth
- **WHEN** a project's change log exceeds the per-project row cap
- **THEN** the oldest rows are deleted down to the cap

### Requirement: Pruning preserves reconcile correctness
Pruning MUST NOT break clients' ability to converge: clients that have fallen behind the pruned window SHALL converge via the snapshot endpoint (a full-state read that does not depend on retained change-log rows). A client whose incremental cursor predates the pruned window SHALL be directed to a full reconcile instead of silently missing changes.

#### Scenario: Lagging client converges after pruning
- **WHEN** a client's incremental sync cursor points before the pruned horizon
- **THEN** the server responds with an indication to reconcile from snapshot, and the client converges to current state

#### Scenario: Active clients are unaffected
- **WHEN** a client syncs regularly (cursor within the retained window)
- **THEN** incremental sync behavior and results are unchanged by pruning

