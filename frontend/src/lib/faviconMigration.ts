/**
 * Web stub for the favicon migration utility.
 *
 * Same exported names/signatures as the extension's
 * `src/lib/faviconMigration.ts`. The extension version persists a one-time
 * migration flag to chrome.storage.local and rewrites stored favicons; none of
 * that applies to the web build (which starts from Google-service favicons and
 * IndexedDB persistence), so every function is a no-op.
 *
 * `isMigrationComplete()` returns `true` so `runFaviconMigrationIfNeeded()`
 * short-circuits and never attempts any work.
 */
import type { AppState } from '@/stores/types';

export interface MigrationResult {
  totalLinks: number;
  updatedLinks: number;
  errors: Array<{ url: string; error: string }>;
}

export async function migrateAllFavicons(state: AppState): Promise<{
  state: AppState;
  result: MigrationResult;
}> {
  return {
    state,
    result: { totalLinks: 0, updatedLinks: 0, errors: [] },
  };
}

export async function executeFaviconMigration(): Promise<MigrationResult> {
  return { totalLinks: 0, updatedLinks: 0, errors: [] };
}

export async function setMigrationComplete(): Promise<void> {}

export async function resetMigrationFlag(): Promise<void> {}

export async function isMigrationComplete(): Promise<boolean> {
  // Treat the migration as already done so it never runs.
  return true;
}

export async function runFaviconMigrationIfNeeded(): Promise<MigrationResult | null> {
  return null;
}
