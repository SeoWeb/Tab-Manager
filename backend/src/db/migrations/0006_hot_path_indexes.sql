-- Hot-path indexes for the sync backend (openspec: scale-sync-backend).
--
-- 0001_init.sql declared no project_id index on any entity table, so every
-- sync hot path scanned whole tables:
--   * collections/links/tasks/notes/todos: per-project entity counts (quota
--     guard), snapshot reads, and existence checks all scanned the table.
--   * project_members: only UNIQUE (project_id, user_id) — unusable for
--     "list a user's projects" (user_id-leading lookups scanned the table).
--   * invitations: only idx_invitations_code; per-project invitation listing
--     scanned the table.
--   * sync_changes: the (project_id, id) cursor index from 0001 cannot serve
--     created_at-range pruning or "latest N by created_at" reads.
--
-- Pure-additive: CREATE INDEX statements only — no table alters, no data
-- changes — so dropping/re-running it never affects correctness.
--
-- Application note: D1 index builds are online (reads/writes continue during
-- the build) but resource-heavy on large tables. Apply off-peak. Statements
-- are ordered smallest-table-first so the heaviest build (sync_changes) runs
-- last.

-- 1. Per-project entity indexes (smallest entity tables first).
CREATE INDEX IF NOT EXISTS idx_collections_project_id
ON collections (project_id);

CREATE INDEX IF NOT EXISTS idx_links_project_id
ON links (project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
ON tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_notes_project_id
ON notes (project_id);

CREATE INDEX IF NOT EXISTS idx_todos_project_id
ON todos (project_id);

-- 2. Member project listing: the UNIQUE (project_id, user_id) constraint from
--    0001 cannot serve user_id-leading lookups.
CREATE INDEX IF NOT EXISTS idx_project_members_user_id
ON project_members (user_id);

-- 3. Per-project invitation listing (0001 only indexed code).
CREATE INDEX IF NOT EXISTS idx_invitations_project_id
ON invitations (project_id);

-- 4. Changelog pruning + created_at-ordered reads; complements the
--    (project_id, id) cursor index from 0001.
CREATE INDEX IF NOT EXISTS idx_sync_changes_project_created_at
ON sync_changes (project_id, created_at);
