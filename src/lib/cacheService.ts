const CACHE_PREFIX = 'favicon_url_cache_';
const CACHE_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  faviconUrl: string;
  timestamp: number;
}

export async function getCachedFavicon(url: string): Promise<string | null> {
  const cacheKey = `${CACHE_PREFIX}${url}`;
  try {
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
    await chrome.storage.local.set({ [cacheKey]: entry });
  } catch (error) {
    console.error('Error setting cached favicon:', error);
  }
}
