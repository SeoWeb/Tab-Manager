/**
 * Favicon Migration Utility
 *
 * This utility provides functions to update all existing favicons with the improved favicon service.
 * It can be run as a one-time migration to improve the quality of all stored favicons.
 */

import { getFaviconUrl, convertChromeFaviconUrl } from './faviconService';
import type { AppState } from '@/stores/types';
import type { Project, Collection, Link } from '@/types';

/**
 * Interface for migration results
 */
export interface MigrationResult {
  totalLinks: number;
  updatedLinks: number;
  errors: Array<{ url: string; error: string }>;
}

/**
 * Updates favicons for all links in a single collection
 */
async function updateCollectionFavicons(collection: Collection): Promise<{
  collection: Collection;
  updatedCount: number;
  errors: Array<{ url: string; error: string }>;
}> {
  if (!collection.links || collection.links.length === 0) {
    return { collection, updatedCount: 0, errors: [] };
  }

  let updatedCount = 0;
  const errors: Array<{ url: string; error: string }> = [];

  const updatedLinks = await Promise.all(
    collection.links.map(async (link: Link) => {
      if (!link.url) return link;

      try {
        // First, convert any existing chrome://favicon URLs to external URLs
        const existingFavicon = link.favIconUrl
          ? convertChromeFaviconUrl(link.favIconUrl)
          : null;

        // Get the updated favicon using the improved service (bypass cache to get fresh favicon)
        const updatedFavicon = await getFaviconUrl(link.url, true);

        // Always update the link to ensure it has a favicon (even if it's the placeholder)
        if (updatedFavicon) {
          // Only count as updated if the favicon actually changed
          if (
            updatedFavicon !== existingFavicon &&
            updatedFavicon !== link.favIconUrl
          ) {
            updatedCount++;
          }
          return { ...link, favIconUrl: updatedFavicon };
        }

        return link;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Error updating favicon for ${link.url}:`, error);
        errors.push({ url: link.url, error: errorMsg });

        // Even if there's an error, try to set a fallback favicon
        if (!link.favIconUrl) {
          return { ...link, favIconUrl: 'https://placehold.co/32x32.png' };
        }

        return link;
      }
    })
  );

  return {
    collection: { ...collection, links: updatedLinks },
    updatedCount,
    errors,
  };
}

/**
 * Updates favicons for all collections in a project
 */
async function updateProjectFavicons(project: Project): Promise<{
  project: Project;
  updatedCount: number;
  errors: Array<{ url: string; error: string }>;
}> {
  if (!project.collections || project.collections.length === 0) {
    return { project, updatedCount: 0, errors: [] };
  }

  let totalUpdatedCount = 0;
  const allErrors: Array<{ url: string; error: string }> = [];

  const updatedCollections = await Promise.all(
    project.collections.map(async (collection: Collection) => {
      const {
        collection: updatedCollection,
        updatedCount,
        errors,
      } = await updateCollectionFavicons(collection);
      totalUpdatedCount += updatedCount;
      allErrors.push(...errors);
      return updatedCollection;
    })
  );

  return {
    project: { ...project, collections: updatedCollections },
    updatedCount: totalUpdatedCount,
    errors: allErrors,
  };
}

/**
 * Main migration function to update all favicons in the app state
 */
export async function migrateAllFavicons(state: AppState): Promise<{
  state: AppState;
  result: MigrationResult;
}> {
  console.log('Starting favicon migration...');

  const { projects = [] } = state;

  if (!projects.length) {
    console.log('No projects found, nothing to migrate.');
    return {
      state,
      result: { totalLinks: 0, updatedLinks: 0, errors: [] },
    };
  }

  console.log(`Found ${projects.length} projects`);

  let totalLinks = 0;
  let updatedLinks = 0;
  const allErrors: Array<{ url: string; error: string }> = [];

  // Process each project
  const updatedProjects = await Promise.all(
    projects.map(async (project: Project) => {
      console.log(`Processing project: ${project.name || 'Untitled'}`);

      // Count total links in this project
      const linksInProject =
        project.collections?.reduce(
          (total: number, collection: Collection) =>
            total + (collection.links?.length || 0),
          0
        ) || 0;
      totalLinks += linksInProject;

      try {
        const {
          project: updatedProject,
          updatedCount,
          errors,
        } = await updateProjectFavicons(project);
        updatedLinks += updatedCount;
        allErrors.push(...errors);

        console.log(
          `  Updated ${updatedCount} favicons in project "${
            project.name || 'Untitled'
          }" (${errors.length} errors)`
        );

        return updatedProject;
      } catch (error) {
        console.error(`Error processing project ${project.name}:`, error);
        allErrors.push({
          url: project.name || 'Untitled Project',
          error: error instanceof Error ? error.message : String(error),
        });
        return project;
      }
    })
  );

  const updatedState = { ...state, projects: updatedProjects };

  console.log(`\nFavicon migration complete!`);
  console.log(`Total links processed: ${totalLinks}`);
  console.log(`Links updated: ${updatedLinks}`);
  console.log(`Errors: ${allErrors.length}`);

  if (allErrors.length > 0) {
    console.error('Errors encountered during migration:', allErrors);
  }

  return {
    state: updatedState,
    result: { totalLinks, updatedLinks, errors: allErrors },
  };
}

/**
 * Executes the favicon migration and saves the updated state to storage
 */
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
    const storageKey = 'tab-manager-storage';
    const stateToPersist = JSON.stringify(updatedState);

    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [storageKey]: stateToPersist }, () => {
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

/**
 * Creates a one-time migration flag in storage to prevent running the migration multiple times
 */
export async function setMigrationComplete(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ 'favicon-migration-complete': true }, resolve);
    });
  }
}

/**
 * Resets the migration flag to allow running the migration again
 * Useful for debugging or re-running after fixing issues
 */
export async function resetMigrationFlag(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['favicon-migration-complete'], resolve);
    });
  }
}

/**
 * Checks if the favicon migration has already been run
 */
export async function isMigrationComplete(): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['favicon-migration-complete'], (result) => {
        resolve(!!result['favicon-migration-complete']);
      });
    });
  }
  return false;
}

/**
 * Runs the favicon migration if it hasn't been run before
 */
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
