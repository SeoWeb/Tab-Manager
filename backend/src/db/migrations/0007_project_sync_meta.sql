-- Pruning horizon bookkeeping for the sync_changes change log (openspec:
-- scale-sync-backend, change-log-retention).
--
-- Why: the daily pruning cron (see src/lib/changelogPruning.ts) deletes old
-- sync_changes rows — retention window plus per-project count cap. The
-- incremental-sync staleness check must then be able to tell a client whose
-- cursor predates the pruned window to reconcile from a snapshot, instead of
-- silently returning an empty delta. One row per project carries the two
-- values pruning maintains:
--
--   horizon_created_at
--     Oldest retained sync_changes.created_at for the project, i.e.
--     MIN(created_at) post-prune. A client whose incremental cursor is older
--     than this horizon cannot be brought up to date from the change log and
--     must be directed to a full snapshot reconcile.
--
--   max_pruned_change_id
--     MAX(sync_changes.id) deleted for the project so far. sync_changes.id is
--     a GLOBAL AUTOINCREMENT shared across projects (0001_init.sql), so it
--     only ever grows: a client cursor below this value points into pruned
--     history, and the sync response must set reconcileRequired (the
--     sync-request horizon check, task 4.4). Kept as the historical maximum
--     across runs — it only grows; a run that deletes nothing leaves it.
--
-- If a project's change log is emptied completely, the pruning run deletes
-- the row again: with zero retained changes there is no delta a lagging
-- client could miss that a snapshot reconcile would not cover.
--
-- Pure-additive: a new table only — no alters of existing tables, no data
-- backfill. Re-running is a no-op (IF NOT EXISTS).
--
-- (0006 is the hot-path index migration; this file is numbered 0007.)
CREATE TABLE IF NOT EXISTS project_sync_meta (
  project_id TEXT PRIMARY KEY,
  horizon_created_at TEXT NOT NULL,      -- oldest retained sync_changes.created_at for the project
  max_pruned_change_id INTEGER NOT NULL, -- MAX(id) deleted so far for the project
  updated_at TEXT NOT NULL
);
