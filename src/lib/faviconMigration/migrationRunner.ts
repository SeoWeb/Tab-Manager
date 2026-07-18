import { migrateAllFavicons, type MigrationResult } from './migrationCore';

const MIGRATION_FLAG_KEY = 'favicon-migration-complete';
const STORAGE_KEY = 'tab-manager-storage';

export async function executeFaviconMigration(): Promise<MigrationResult> {
  // Get the current state from the store
  const store = await import('@/stores/appStore').then(
    (module) => module.useAppStore
  );

  const currentState = store.getState();

  // Perform the migration
  const { state: updatedState, result } =
    await migrateAllFavicons(currentState);

  // Update the store with the migrated state
  store.setState(updatedState);

  // Force persist to storage by manually calling the storage API
  // This ensures the updated state is immediately persisted
  try {
    const stateToPersist = JSON.stringify(updatedState);

    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: stateToPersist }, () => {
          console.log('Favicon migration state persisted to storage');
          resolve();
        });
      });
    }
  } catch (error) {
    console.error('Failed to persist migration state to storage:', error);
  }

  return result;
}

export async function setMigrationComplete(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true }, resolve);
    });
  } else if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
  }
}

export async function resetMigrationFlag(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([MIGRATION_FLAG_KEY], resolve);
    });
  } else if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(MIGRATION_FLAG_KEY);
  }
}

export async function isMigrationComplete(): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get([MIGRATION_FLAG_KEY], (result) => {
        resolve(!!result[MIGRATION_FLAG_KEY]);
      });
    });
  } else if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(MIGRATION_FLAG_KEY) === 'true';
  }
  return false;
}

export async function runFaviconMigrationIfNeeded(): Promise<MigrationResult | null> {
  const migrationComplete = await isMigrationComplete();

  if (migrationComplete) {
    console.log('Favicon migration has already been completed.');
    return null;
  }

  console.log('Running favicon migration...');
  const result = await executeFaviconMigration();

  // Mark the migration as complete
  await setMigrationComplete();

  return result;
}
