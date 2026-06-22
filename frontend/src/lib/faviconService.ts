/**
 * Web favicon service — Google service only.
 *
 * Same exported names/signatures as the extension's `src/lib/faviconService.ts`
 * so `useFavicon` (and any other importer) resolves unchanged. The web version
 * drops the Chrome-only sources:
 *   - `getTabsFavicon()`   — `chrome.tabs.query` (no chrome.tabs on the web)
 *   - `getChromeCacheFavicon()` — `chrome://favicon` URLs (extension-only)
 *
 * Resolution order collapses to: cache → Google service → placeholder.
 * `convertChromeFaviconUrl()` is kept so any `chrome://favicon` URLs that
 * survived in migrated data are still normalized to a web-loadable URL.
 */
import { getCachedFavicon, setCachedFavicon } from './cacheService';

const PLACEHOLDER_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEklEQVR42mNkIAAYIeACwB4AACQ6A/0I6a9hAAAAAElFTkSuQmCC';

// Types of favicon sources (kept for `getFaviconWithSource` parity).
enum FaviconSource {
  CACHED = 'cached',
  GOOGLE_SERVICE = 'google_service',
  PLACEHOLDER = 'placeholder',
}

interface FaviconResult {
  url: string;
  source: FaviconSource;
}

/**
 * Ensures a URL has a protocol
 */
function getFullUrl(url: string): string {
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
function extractDomain(url: string): string {
  try {
    const urlObject = new URL(getFullUrl(url));
    return urlObject.hostname;
  } catch {
    return url;
  }
}

/**
 * Converts chrome://favicon URLs to external URLs that can be displayed in
 * regular img tags. Kept for parity / to normalize any migrated data; the web
 * service never produces chrome:// URLs itself.
 */
export function convertChromeFaviconUrl(url: string): string {
  if (url.startsWith('chrome://favicon/')) {
    const match = url.match(/chrome:\/\/favicon\/.*\/(https?:\/\/[^/]+)/);
    if (match && match[1]) {
      try {
        const urlObj = new URL(match[1]);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
      } catch {
        return PLACEHOLDER_FAVICON;
      }
    }
  }
  return url;
}

/**
 * Gets favicon from Google's service
 */
function getGoogleFavicon(url: string): FaviconResult {
  const domain = extractDomain(url);
  return {
    url: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    source: FaviconSource.GOOGLE_SERVICE,
  };
}

/**
 * Main function to get favicon URL with caching.
 *
 * 1. Check cache first for a previously stored favicon
 * 2. Fall back to Google's favicon service
 * 3. If that fails, return the placeholder
 *
 * @param url The URL to get favicon for
 * @param bypassCache If true, skips cache check and forces a fresh fetch
 * @returns Promise resolving to favicon URL
 */
export async function getFaviconUrl(
  url: string,
  bypassCache = false
): Promise<string> {
  if (!url) return PLACEHOLDER_FAVICON;

  const domain = extractDomain(url);

  // 1. Check cache first (unless bypassed)
  if (!bypassCache) {
    const cachedFavicon = await getCachedFavicon(domain);
    if (cachedFavicon) {
      return convertChromeFaviconUrl(cachedFavicon);
    }
  }

  // 2. Google favicon service
  try {
    const result = getGoogleFavicon(url);
    if (result && result.url) {
      await setCachedFavicon(domain, result.url);
      return result.url;
    }
  } catch (error) {
    console.warn('Google service failed for favicon:', url, error);
  }

  // 3. Placeholder
  return PLACEHOLDER_FAVICON;
}

/**
 * Gets favicon URL and preserves the source information
 * (kept for parity with the extension service).
 */
export async function getFaviconWithSource(
  url: string
): Promise<{ url: string; source: string }> {
  const domain = extractDomain(url);

  const cachedFavicon = await getCachedFavicon(domain);
  if (cachedFavicon) {
    return { url: cachedFavicon, source: 'cached' };
  }

  const googleResult = getGoogleFavicon(url);
  await setCachedFavicon(domain, googleResult.url);
  return { url: googleResult.url, source: 'google_service' };
}

/**
 * Preloads and caches favicon for a URL.
 */
export async function preloadFavicon(url: string): Promise<string> {
  return await getFaviconUrl(url, false);
}

/**
 * Refreshes cached favicon for a URL (bypasses cache).
 */
export async function refreshFavicon(url: string): Promise<string> {
  return await getFaviconUrl(url, true);
}
