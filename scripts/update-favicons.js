/**
 * One-time script to update all existing favicons with the improved favicon service
 *
 * This script will:
 * 1. Load all existing links from storage
 * 2. Update their favicons using the new improved service
 * 3. Save the updated links back to storage
 *
 * Run this script in the browser console or as a Chrome extension background script
 */

// Import the necessary functions (adjust paths as needed)
// Note: In a real Chrome extension, these would be imported properly
// import { getFaviconUrl } from '../src/lib/faviconService.js';

// Since we're running this as a standalone script, we'll define the necessary functions here

const PLACEHOLDER_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEklEQVR42mNkIAAYIeACwB4AACQ6A/DBa6hAAAAAElFTkSuQmCC';

// Types of favicon sources in order of preference
const FaviconSource = {
  TABS_API: 'tabs_api',
  CACHED: 'cached',
  EXTRACTED: 'extracted',
  CHROME_CACHE: 'chrome_cache',
  GOOGLE_SERVICE: 'google_service',
  PLACEHOLDER: 'placeholder',
};

/**
 * Ensures a URL has a protocol
 */
function getFullUrl(url) {
  // Ensure the URL has a protocol
  let urlWithProtocol = url;
  if (!/^https?:\/\//i.test(url)) {
    urlWithProtocol = `https://${url}`;
  }

  const urlObject = new URL(urlWithProtocol);
  return urlObject.href;
}

/**
 * Extracts domain from URL
 */
function extractDomain(url) {
  try {
    const urlObject = new URL(getFullUrl(url));
    return urlObject.hostname;
  } catch {
    return url;
  }
}

/**
 * Gets favicon from Chrome tabs API (highest quality)
 */
async function getTabsFavicon(url) {
  try {
    // First try Chrome tabs API with exact URL match
    const tabs = await chrome.tabs.query({ url: getFullUrl(url) });
    if (tabs[0]?.favIconUrl) {
      return {
        url: tabs[0].favIconUrl,
        source: FaviconSource.TABS_API,
      };
    }

    // Try with partial URL match (some tabs might have additional parameters)
    const domain = extractDomain(url);
    const allTabs = await chrome.tabs.query({});
    const matchingTab = allTabs.find(
      (tab) => tab.url && tab.url.includes(domain) && tab.favIconUrl
    );

    if (matchingTab?.favIconUrl) {
      return {
        url: matchingTab.favIconUrl,
        source: FaviconSource.TABS_API,
      };
    }
  } catch (error) {
    console.error('Error fetching favicon from tabs API:', error);
  }
  return null;
}

/**
 * Gets favicon from Chrome's favicon cache
 */
function getChromeCacheFavicon(url) {
  const urlObj = new URL(getFullUrl(url));
  return {
    url: `chrome://favicon/size/32@1x/${urlObj.origin}`,
    source: FaviconSource.CHROME_CACHE,
  };
}

/**
 * Gets favicon from Google's service
 */
function getGoogleFavicon(url) {
  const domain = extractDomain(url);
  return {
    url: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    source: FaviconSource.GOOGLE_SERVICE,
  };
}

/**
 * Gets favicon from cache
 */
async function getCachedFavicon(domain) {
  return new Promise((resolve) => {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(['favicon-cache'], (result) => {
        const cache = result['favicon-cache'] || {};
        const cachedItem = cache[domain];

        if (cachedItem && cachedItem.expiry > Date.now()) {
          resolve(cachedItem.url);
        } else {
          resolve(null);
        }
      });
    } else {
      resolve(null);
    }
  });
}

/**
 * Sets favicon in cache
 */
async function setCachedFavicon(domain, url) {
  return new Promise((resolve) => {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(['favicon-cache'], (result) => {
        const cache = result['favicon-cache'] || {};

        // Set cache with 30-day expiration
        cache[domain] = {
          url,
          expiry: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days in ms
        };

        chrome.storage.local.set({ 'favicon-cache': cache }, resolve);
      });
    } else {
      resolve();
    }
  });
}

/**
 * Main function to get favicon URL with comprehensive caching
 */
async function getFaviconUrl(url, bypassCache = false) {
  if (!url) return PLACEHOLDER_FAVICON;

  const domain = extractDomain(url);
  let result = null;

  // 1. Check cache first (unless bypassed)
  if (!bypassCache) {
    const cachedFavicon = await getCachedFavicon(domain);
    if (cachedFavicon) {
      return cachedFavicon;
    }
  }

  // 2. Try Chrome tabs API (highest quality)
  result = await getTabsFavicon(url);
  if (result) {
    await setCachedFavicon(domain, result.url);
    return result.url;
  }

  // 3. Try Chrome's favicon cache
  result = getChromeCacheFavicon(url);
  await setCachedFavicon(domain, result.url);

  // Chrome cache should always return a valid URL, but just in case
  if (result.url) {
    return result.url;
  }

  // 4. Fall back to Google's service
  result = getGoogleFavicon(url);
  await setCachedFavicon(domain, result.url);
  return result.url;
}

/**
 * Loads the current state from storage
 */
async function loadStateFromStorage() {
  return new Promise((resolve) => {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(['tab-manager-storage'], (result) => {
        try {
          const stateString = result['tab-manager-storage'];
          if (stateString) {
            const state = JSON.parse(stateString);
            resolve(state);
          } else {
            resolve({ projects: [] });
          }
        } catch (error) {
          console.error('Error parsing stored state:', error);
          resolve({ projects: [] });
        }
      });
    } else {
      resolve({ projects: [] });
    }
  });
}

/**
 * Saves the updated state to storage
 */
async function saveStateToStorage(state) {
  return new Promise((resolve) => {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.set(
        {
          'tab-manager-storage': JSON.stringify(state),
        },
        resolve
      );
    } else {
      resolve();
    }
  });
}

/**
 * Updates favicons for all links in all projects and collections
 */
async function updateAllFavicons() {
  console.log('Starting favicon update process...');

  // Load current state
  const state = await loadStateFromStorage();
  const { projects = [] } = state;

  if (!projects.length) {
    console.log('No projects found, nothing to update.');
    return;
  }

  console.log(`Found ${projects.length} projects`);

  let totalLinks = 0;
  let updatedLinks = 0;

  // Process each project
  for (const project of projects) {
    if (!project.collections || !project.collections.length) continue;

    console.log(`Processing project: ${project.name || 'Untitled'}`);

    // Process each collection in the project
    for (const collection of project.collections) {
      if (!collection.links || !collection.links.length) continue;

      console.log(
        `  Processing collection: ${collection.name || 'Untitled'} with ${collection.links.length} links`
      );

      // Process each link in the collection
      for (const link of collection.links) {
        totalLinks++;

        if (!link.url) continue;

        try {
          // Get the updated favicon using the improved service
          const updatedFavicon = await getFaviconUrl(link.url, true); // bypass cache to get fresh favicon

          // Update the link if the favicon has changed
          if (updatedFavicon && updatedFavicon !== link.favIconUrl) {
            link.favIconUrl = updatedFavicon;
            updatedLinks++;
            console.log(`    Updated favicon for: ${link.title || link.url}`);
          }
        } catch (error) {
          console.error(`    Error updating favicon for ${link.url}:`, error);
        }
      }
    }
  }

  // Save the updated state
  await saveStateToStorage(state);

  console.log(`\nFavicon update complete!`);
  console.log(`Total links processed: ${totalLinks}`);
  console.log(`Links updated: ${updatedLinks}`);

  return { totalLinks, updatedLinks };
}

// Export the function for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { updateAllFavicons };
} else {
  // In browser/extension context, attach to window
  window.updateAllFavicons = updateAllFavicons;
  console.log(
    'updateAllFavicons function attached to window. Run updateAllFavicons() to start the process.'
  );
}
