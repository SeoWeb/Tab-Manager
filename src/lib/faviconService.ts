import { getCachedFavicon, setCachedFavicon } from './cacheService';

const PLACEHOLDER_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEklEQVR42mNkIAAYIeACwB4AACQ6A/0I6a9hAAAAAElFTkSuQmCC';

// Types of favicon sources in order of preference
enum FaviconSource {
  TABS_API = 'tabs_api',
  CACHED = 'cached',
  EXTRACTED = 'extracted',
  CHROME_CACHE = 'chrome_cache',
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
function extractDomain(url: string): string {
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
async function getTabsFavicon(url: string): Promise<FaviconResult | null> {
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
 * Note: This returns chrome://favicon URLs which only work in extension contexts
 * These should be converted to external URLs before storing
 */
function getChromeCacheFavicon(url: string): FaviconResult {
  const urlObj = new URL(getFullUrl(url));
  return {
    url: `chrome://favicon/size/32@1x/${urlObj.origin}`,
    source: FaviconSource.CHROME_CACHE,
  };
}

/**
 * Converts chrome://favicon URLs to external URLs that can be displayed in regular img tags
 */
export function convertChromeFaviconUrl(url: string): string {
  if (url.startsWith('chrome://favicon/')) {
    // Extract the origin from the chrome://favicon URL
    const match = url.match(/chrome:\/\/favicon\/.*\/(https?:\/\/[^/]+)/);
    if (match && match[1]) {
      // Use Google's favicon service as a fallback for chrome://favicon URLs
      try {
        const urlObj = new URL(match[1]);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
      } catch {
        // If parsing fails, return placeholder
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
 * Extracts favicon from webpage HTML
 * Note: Currently unused but kept for future implementation
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function extractFaviconFromPage(
  url: string
): Promise<FaviconResult | null> {
  try {
    const response = await fetch(getFullUrl(url), { mode: 'no-cors' });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(
      doc.querySelectorAll<HTMLLinkElement>("link[rel*='icon']")
    );

    if (links.length === 0) {
      return null;
    }

    // Prioritize certain 'rel' values
    const relPriority = ['apple-touch-icon', 'icon', 'shortcut icon'];
    links.sort((a, b) => {
      const relA = relPriority.indexOf(a.rel);
      const relB = relPriority.indexOf(b.rel);
      if (relA === -1) return 1;
      if (relB === -1) return -1;
      return relA - relB;
    });

    // Find the highest quality icon (e.g., largest size)
    let bestIcon = links[0];
    let maxSize = 0;

    for (const link of links) {
      const sizes = link.getAttribute('sizes');
      if (sizes) {
        const size = parseInt(sizes.split('x')[0], 10);
        if (size > maxSize) {
          maxSize = size;
          bestIcon = link;
        }
      }
    }

    return {
      url: new URL(bestIcon.href, getFullUrl(url)).href,
      source: FaviconSource.EXTRACTED,
    };
  } catch (error) {
    console.error(`Failed to extract favicon for ${url}:`, error);
    return null;
  }
}

/**
 * Main function to get favicon URL with comprehensive caching
 *
 * This function implements a priority-based approach:
 * 1. Check cache first for previously stored high-quality favicons
 * 2. Try Chrome tabs API for the best quality favicon
 * 3. Try Chrome's favicon cache
 * 4. Try extracting from HTML (currently disabled for performance)
 * 5. Fall back to Google's service
 *
 * @param url The URL to get favicon for
 * @param bypassCache If true, skips cache check and forces fresh fetch
 * @returns Promise resolving to favicon URL
 */
export async function getFaviconUrl(
  url: string,
  bypassCache = false
): Promise<string> {
  if (!url) return PLACEHOLDER_FAVICON;

  const domain = extractDomain(url);
  let result: FaviconResult | null = null;

  // 1. Check cache first (unless bypassed)
  if (!bypassCache) {
    const cachedFavicon = await getCachedFavicon(domain);
    if (cachedFavicon) {
      // Convert any chrome://favicon URLs to external URLs
      return convertChromeFaviconUrl(cachedFavicon);
    }
  }

  // 2. Try Chrome tabs API (highest quality)
  try {
    result = await getTabsFavicon(url);
    if (result && result.url) {
      // Convert chrome://favicon URLs to external URLs before caching
      const externalUrl = convertChromeFaviconUrl(result.url);
      await setCachedFavicon(domain, externalUrl);
      return externalUrl;
    }
  } catch (error) {
    console.warn('Chrome tabs API failed for favicon:', url, error);
  }

  // 3. Skip Chrome's favicon cache and go directly to Google's service
  // Chrome cache URLs can't be displayed in regular img tags
  try {
    result = getGoogleFavicon(url);
    if (result && result.url) {
      await setCachedFavicon(domain, result.url);
      return result.url;
    }
  } catch (error) {
    console.warn('Google service failed for favicon:', url, error);
  }

  // 4. If all else fails, return placeholder
  console.warn('All favicon sources failed for:', url, 'using placeholder');
  return PLACEHOLDER_FAVICON;
}

/**
 * Gets favicon URL and preserves the source information
 * Useful for debugging and understanding where favicons come from
 */
export async function getFaviconWithSource(
  url: string
): Promise<{ url: string; source: string }> {
  const domain = extractDomain(url);

  // Check cache first
  const cachedFavicon = await getCachedFavicon(domain);
  if (cachedFavicon) {
    return { url: cachedFavicon, source: 'cached' };
  }

  // Try Chrome tabs API
  const tabsResult = await getTabsFavicon(url);
  if (tabsResult) {
    await setCachedFavicon(domain, tabsResult.url);
    return { url: tabsResult.url, source: 'tabs_api' };
  }

  // Try Chrome's favicon cache
  const chromeResult = getChromeCacheFavicon(url);
  await setCachedFavicon(domain, chromeResult.url);
  return { url: chromeResult.url, source: 'chrome_cache' };
}

/**
 * Preloads and caches favicon for a URL
 * Useful when adding new links from tabs to preserve high-quality favicons
 */
export async function preloadFavicon(url: string): Promise<string> {
  return await getFaviconUrl(url, false);
}

/**
 * Updates cached favicon for a URL
 * Useful when a URL changes or favicon needs refreshing
 */
export async function refreshFavicon(url: string): Promise<string> {
  return await getFaviconUrl(url, true); // bypassCache = true
}
