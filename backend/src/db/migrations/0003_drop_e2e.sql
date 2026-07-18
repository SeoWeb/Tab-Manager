-- Roll back the abandoned cloud E2E encryption schema (originally 0003_e2e_keys.sql).
-- D1/SQLite does not support DROP COLUMN IF EXISTS, so the column drops below
-- are plain DROP COLUMN statements. On databases where 0003 was never applied
-- (or only partially applied) those columns are simply absent and the
-- statements can be safely skipped; the DROP TABLE IF EXISTS above is always safe.

DROP TABLE IF EXISTS project_keys;

ALTER TABLE users DROP COLUMN public_key;
ALTER TABLE users DROP COLUMN wrapped_private_key;
ALTER TABLE users DROP COLUMN key_salt;
ALTER TABLE projects DROP COLUMN encrypted;
