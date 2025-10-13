# Favicon Migration Guide

This document explains how to use the favicon migration feature to update all existing favicons with the improved favicon service.

## Overview

The favicon migration feature updates all existing link favicons using an improved service that:

- Prioritizes high-quality favicons from the Chrome tabs API
- Implements better caching with 30-day expiration
- Preserves tab favicons when dragging tabs to collections
- Provides more reliable fallback mechanisms

## How to Run the Migration

### Method 1: Using the Web Interface (Recommended)

1. Navigate to the `/favicon-migration` page in your TabManager extension
2. Click the "Update All Favicons" button
3. Wait for the migration to complete
4. The page will show you the results including how many links were updated

### Method 2: Using the Browser Console

1. Open the TabManager extension
2. Open the browser developer tools (F12)
3. Run the following code in the console:

```javascript
// Import and run the migration
import('/src/lib/faviconMigration.js').then((module) => {
  module.runFaviconMigrationIfNeeded().then((result) => {
    console.log('Migration result:', result);
  });
});
```

### Method 3: Using the Standalone Script

For advanced users, you can use the standalone script in `scripts/update-favicons.js`:

1. Load the script in your extension context
2. Call `updateAllFavicons()` function

## What the Migration Does

1. **Loads all existing links** from your projects and collections
2. **Updates each favicon** using the improved service
3. **Bypasses cache** to get the freshest high-quality favicons
4. **Saves the updated links** back to storage
5. **Marks migration as complete** to prevent running again

## Migration Results

After the migration completes, you'll see:

- **Total links processed**: The total number of links found in your projects
- **Links updated**: How many links had their favicons improved
- **Errors**: Any issues encountered during the migration (if any)

## Technical Details

### Favicon Priority System

The improved favicon service uses this priority order:

1. **Chrome tabs API** - Highest quality favicons from open tabs
2. **Chrome cache** - Cached favicons from Chrome's storage
3. **Google service** - Fallback favicon service

### Caching Strategy

- Favicons are cached for 30 days
- Cache respects the source of each favicon
- Cache can be bypassed for fresh updates

### Migration Tracking

- A flag is stored in Chrome storage to track if migration has been run
- This prevents the migration from running multiple times
- The flag can be reset if needed (advanced use case)

## Troubleshooting

### Migration Not Working

1. Ensure you're running the migration in the extension context
2. Check that Chrome storage is available
3. Look for error messages in the console

### Partial Migration

If the migration only updates some links:

1. Some URLs might be invalid or inaccessible
2. Check the error count in the migration results
3. Individual links can be updated manually by editing them

### Resetting Migration

To run the migration again (advanced):

```javascript
// Clear the migration flag
chrome.storage.local.remove(['favicon-migration-complete']);
```

## After Migration

Once the migration is complete:

- All new links will automatically use the improved favicon service
- Favicons will be cached for 30 days
- High-quality tab favicons will be preserved when dragging tabs to collections
- The migration page will show that migration is complete

## Files Related to Favicon Migration

- `src/lib/faviconService.ts` - Core favicon service with priority-based fetching
- `src/lib/faviconMigration.ts` - Migration utilities and functions
- `src/components/FaviconMigrationButton.tsx` - UI component for running migration
- `src/app/favicon-migration/page.tsx` - Migration page
- `scripts/update-favicons.js` - Standalone migration script
