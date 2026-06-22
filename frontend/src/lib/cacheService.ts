/**
 * Web favicon cache.
 *
 * Deliberately stays on `localStorage` (not IndexedDB): the cached values are
 * tiny URL strings, well under any quota, and `useFavicon` reads them in render
 * — routing through async idb would churn the favicon hook for no benefit. If
 * uniformity is ever wanted, move this to idb and make `useFavicon` async.
 *
 * Mirrors the extension's `chrome.storage.local`-backed cache: same export
 * names (`getCachedFavicon`, `setCachedFavicon`) and same cache key prefix /
 * 30-day expiry. The extension stored the entry object directly via structured
 * clone; localStorage only holds strings, so we JSON-encode it here.
 */
const CACHE_PREFIX = 'favicon_url_cache_';
const CACHE_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  faviconUrl: string;
  timestamp: number;
}

export async function getCachedFavicon(url: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const cacheKey = `${CACHE_PREFIX}${url}`;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
        return entry.faviconUrl;
      }
      // Cache expired, remove it.
      window.localStorage.removeItem(cacheKey);
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
  if (typeof window === 'undefined') return;
  const cacheKey = `${CACHE_PREFIX}${url}`;
  const entry: CacheEntry = {
    faviconUrl,
    timestamp: Date.now(),
  };
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (error) {
    console.error('Error setting cached favicon:', error);
  }
}
