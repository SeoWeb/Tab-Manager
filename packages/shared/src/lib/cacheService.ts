// Favicon URL cache (shared package).
//
// One canonical copy for both consumers, with a per-context backend seam:
//
//  - Extension contexts: chrome.storage.local stores the entry object
//    directly via structured clone (original behavior, unchanged).
//  - Plain-web contexts: deliberately localStorage, not IndexedDB — the
//    cached values are tiny URL strings, well under any quota, and
//    `useFavicon` reads them in render; routing through async idb would churn
//    the favicon hook for no benefit. localStorage only holds strings, so the
//    entry is JSON-encoded (same cache key prefix / 30-day expiry).
//  - SSR / static pre-render has neither backend: degrade to a cache miss.

const CACHE_PREFIX = 'favicon_url_cache_';
const CACHE_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  faviconUrl: string;
  timestamp: number;
}

const isChromeStorageAvailable = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

const isBrowser = (): boolean => typeof window !== 'undefined';

export async function getCachedFavicon(url: string): Promise<string | null> {
  const cacheKey = `${CACHE_PREFIX}${url}`;
  try {
    if (isChromeStorageAvailable()) {
      const result = await chrome.storage.local.get(cacheKey);
      if (result[cacheKey]) {
        const entry: CacheEntry = result[cacheKey];
        if (Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
          return entry.faviconUrl;
        } else {
          // Cache expired, remove it
          await chrome.storage.local.remove(cacheKey);
        }
      }
    } else if (isBrowser()) {
      const raw = window.localStorage.getItem(cacheKey);
      if (raw) {
        const entry: CacheEntry = JSON.parse(raw);
        if (Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
          return entry.faviconUrl;
        }
        // Cache expired, remove it.
        window.localStorage.removeItem(cacheKey);
      }
    }
  } catch (error) {
    console.error('Error getting cached favicon:', error);
  }
  return null;
}

export async function setCachedFavicon(
  url: string,
  faviconUrl: string
): Promise<void> {
  const cacheKey = `${CACHE_PREFIX}${url}`;
  const entry: CacheEntry = {
    faviconUrl,
    timestamp: Date.now(),
  };
  try {
    if (isChromeStorageAvailable()) {
      await chrome.storage.local.set({ [cacheKey]: entry });
    } else if (isBrowser()) {
      window.localStorage.setItem(cacheKey, JSON.stringify(entry));
    }
  } catch (error) {
    console.error('Error setting cached favicon:', error);
  }
}
