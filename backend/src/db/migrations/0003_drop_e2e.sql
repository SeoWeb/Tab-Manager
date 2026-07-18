-- Roll back the abandoned cloud E2E encryption schema (originally 0003_e2e_keys.sql).
--
-- D1/SQLite does not support `DROP COLUMN IF EXISTS` or any conditional DDL, and
-- `wrangler d1 execute` aborts the whole file on the first statement error. So a
-- plain `ALTER TABLE ... DROP COLUMN` on a column that is absent (any database
-- built from the canonical 0001/0002 schema, or one where 0003 was only
-- partially applied) would hard-fail and block every later migration.
--
-- We instead rebuild `users` and `projects` selecting only their canonical
-- columns. On a database that never carried the E2E columns this is an
-- identity transform (same columns, same rows) and therefore a safe no-op; on a
-- database where the abandoned 0003_e2e_keys migration ran, the extra columns
-- (users.public_key / wrapped_private_key / key_salt and projects.encrypted)
-- are dropped. The rebuild is idempotent and runs cleanly on any DB state.
-- `DROP TABLE IF EXISTS project_keys` is always safe.

DROP TABLE IF EXISTS project_keys;

-- ---------------------------------------------------------------------------
-- users: rebuild keeping only canonical columns (drops E2E columns if present)
-- ---------------------------------------------------------------------------
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO users_new (id, email, display_name, created_at, updated_at)
SELECT id, email, display_name, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- ---------------------------------------------------------------------------
-- projects: rebuild keeping only canonical columns (drops `encrypted` if present)
-- ---------------------------------------------------------------------------
CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
INSERT INTO projects_new (id, name, description, color, icon, owner_id, created_at, updated_at, deleted_at)
SELECT id, name, description, color, icon, owner_id, created_at, updated_at, deleted_at FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
