-- Enforce per-project idempotency of client mutation ids in the sync changelog.
--
-- The sync endpoint treats (project_id, client_mutation_id) as a replay key:
-- the mutation applier looks up previously logged rows to drop replays, but
-- nothing at the schema level stopped two concurrent pushes from racing past
-- that check and logging the same mutation twice. This migration backfills the
-- invariant on existing databases and then enforces it going forward.
--
-- Idempotency: this file runs exactly once per database under the wrangler
-- migration framework (recorded in `d1_migrations`), so plain SQLite DDL is
-- fine — SQLite has no `CREATE UNIQUE INDEX IF NOT EXISTS`, and does not need
-- one under the framework's once-only guarantee.

-- ---------------------------------------------------------------------------
-- Step 1: de-duplicate existing rows on (project_id, client_mutation_id).
--
-- "Earliest" = smallest `created_at`, then smallest `id`. `created_at` is
-- written by the Worker itself via nowIso() (ISO-8601 UTC, see
-- src/lib/sync/shared.ts), so lexicographic order equals chronological order;
-- `id` (AUTOINCREMENT rowid, i.e. insertion order) is a deterministic
-- tiebreaker for rows stamped within the same instant.
--
-- Rows with a NULL `client_mutation_id` are never duplicates of anything —
-- SQLite treats NULLs as distinct in unique indexes — so they are left
-- untouched and the unique index below accepts any number of them.
-- ---------------------------------------------------------------------------

DELETE FROM sync_changes
WHERE client_mutation_id IS NOT NULL
  AND id <> (
    SELECT keeper.id
    FROM sync_changes AS keeper
    WHERE keeper.project_id = sync_changes.project_id
      AND keeper.client_mutation_id = sync_changes.client_mutation_id
    ORDER BY keeper.created_at ASC, keeper.id ASC
    LIMIT 1
  );

-- ---------------------------------------------------------------------------
-- Step 2: enforce the invariant with a unique index.
-- (The existing non-unique idx_sync_changes_client_mutation from 0001 stays:
-- the applier's replay lookup filters on client_mutation_id alone, which this
-- project-leading index does not serve.)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX idx_sync_changes_project_mutation
ON sync_changes (project_id, client_mutation_id);
