/**
 * Favicon Migration Utility
 *
 * This utility provides functions to update all existing favicons with the improved favicon service.
 * It can be run as a one-time migration to improve the quality of all stored favicons.
 */

export type { MigrationResult } from './faviconMigration/migrationCore';
export { migrateAllFavicons } from './faviconMigration/migrationCore';
export {
  executeFaviconMigration,
  setMigrationComplete,
  resetMigrationFlag,
  isMigrationComplete,
  runFaviconMigrationIfNeeded,
} from './faviconMigration/migrationRunner';
