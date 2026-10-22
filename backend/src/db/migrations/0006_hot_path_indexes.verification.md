# Verification: 0006_hot_path_indexes.sql

Verified locally against `tab-manager-dev` (wrangler 4.112.0, `--local`) on 2026-10-20.

## What was done

1. `npx wrangler d1 migrations apply tab-manager-dev --local` — applied
   `0005_purge_plaintext_login_codes.sql` (was pending) and
   `0006_hot_path_indexes.sql` (8 `CREATE INDEX` statements). All succeeded.
2. Seeded dummy data into the **local dev DB only** via a temp SQL file in
   `/tmp/opencode` (kept out of the repo): 1 user `u` / project `p` /
   `entity_versions('p','link','e')` row / invitation, plus ~400 extra
   `project_members` rows, 801 links (incl. id `x`), 150 collections, and 600
   `sync_changes` rows dated 2019 (so `created_at < '2020-01-01'` matches a
   real range). **Rows were left in place** — local DB is disposable dev state.
3. Ran `EXPLAIN QUERY PLAN` for each hot-path query. No plan contains
   `SCAN <table>`; all 8 indexes confirmed present via `sqlite_master`.

## Verified query plans

| # | Hot path | Query | Plan (`detail` line) |
|---|----------|-------|----------------------|
| 1 | Entity existence | `SELECT id FROM links WHERE id='x' AND project_id='p' AND deleted_at IS NULL` | `SEARCH links USING INDEX sqlite_autoindex_links_1 (id=?)` — PK lookup, expected |
| 2 | Per-project entity count | `SELECT COUNT(*) FROM links WHERE project_id='p' AND deleted_at IS NULL` | `SEARCH links USING INDEX idx_links_project_id (project_id=?)` |
| 3 | Member project listing | `SELECT project_id FROM project_members WHERE user_id='u'` | `SEARCH project_members USING INDEX idx_project_members_user_id (user_id=?)` |
| 4 | Snapshot read | `SELECT id FROM collections WHERE project_id='p'` | `SEARCH collections USING INDEX idx_collections_project_id (project_id=?)` |
| 5 | Changelog prune | `SELECT id, created_at FROM sync_changes WHERE project_id='p' AND created_at < '2020-01-01' ORDER BY created_at LIMIT 10` | `SEARCH sync_changes USING COVERING INDEX idx_sync_changes_project_created_at (project_id=? AND created_at<?)` — covering; no `USE TEMP B-TREE FOR ORDER BY` row (index satisfies the ordering) |
| 6 | Changelog latest | `SELECT id, created_at FROM sync_changes WHERE project_id='p' ORDER BY created_at DESC LIMIT 10` | `SEARCH sync_changes USING COVERING INDEX idx_sync_changes_project_created_at (project_id=?)` — reverse range scan, covering |
| 7 | Version read | `SELECT version FROM entity_versions WHERE project_id='p' AND entity_type='link' AND entity_id='e'` | `SEARCH entity_versions USING INDEX sqlite_autoindex_entity_versions_1 (project_id=? AND entity_type=? AND entity_id=?)` — 0001 PK autoindex |

Indexes created but not probed above (`tasks`, `notes`, `todos`, `invitations`
mirror the `collections`/`links` pattern) were confirmed created in the same
applied migration and are present in `sqlite_master`:
`idx_tasks_project_id`, `idx_notes_project_id`, `idx_todos_project_id`,
`idx_invitations_project_id`.
