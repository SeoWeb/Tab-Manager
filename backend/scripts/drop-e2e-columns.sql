-- MANUAL, ONE-TIME cleanup for a hypothetical straggler database that still
-- carries the abandoned cloud E2E encryption schema.
--
-- ⚠️ NEVER run this automatically and NEVER put it in backend/src/db/migrations/:
-- automatic migration steps must not perform destructive DDL (the old
-- 0003_drop_e2e.sql migration was removed from the set for exactly that
-- reason — see deployment.md, "Migration history / removed 0003").
--
-- Do these E2E columns even exist on your database? They can only exist if the
-- original, since-deleted `0003_e2e_keys.sql` migration ran on it. Real
-- databases (the remote DB and all rebuilt local dev states) are canonical and
-- this script is a no-op for them — there is nothing to clean up. Verify
-- before running:
--
--   npx wrangler d1 execute tab-manager-dev --remote \
--     --command "SELECT name FROM pragma_table_info('users') WHERE name IN ('public_key','wrapped_private_key','key_salt');"
--   npx wrangler d1 execute tab-manager-dev --remote \
--     --command "SELECT name FROM pragma_table_info('projects') WHERE name = 'encrypted';"
--
-- If both come back empty and `project_keys` does not exist, STOP — nothing to
-- do. If columns ARE present:
--
--   1. Take and verify a backup first (see deployment.md, mandatory backup
--      prerequisite):
--        npx wrangler d1 export tab-manager-dev --remote --output=backup-$(date +%F).sql
--   2. Run this file explicitly, as a logged, deliberate step:
--        npx wrangler d1 execute tab-manager-dev --remote --file=scripts/drop-e2e-columns.sql
--   3. Re-run the pragma_table_info checks from above — both must be empty.
--
-- `ALTER TABLE ... DROP COLUMN` (SQLite ≥ 3.35, supported by D1) preserves all
-- rows; it errors if the column is absent, which is exactly why this must stay
-- a checked, manual operation.

ALTER TABLE users DROP COLUMN public_key;
ALTER TABLE users DROP COLUMN wrapped_private_key;
ALTER TABLE users DROP COLUMN key_salt;
ALTER TABLE projects DROP COLUMN encrypted;

DROP TABLE IF EXISTS project_keys;
