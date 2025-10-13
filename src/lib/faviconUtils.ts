import { preloadFavicon } from './utils';
import type { ChromeTabInfo } from '@/types';

/**
 * Extracts favicon from a Chrome tab and creates link data with the favicon
 * This function ensures that when dragging tabs to collections, the high-quality
 * favicon from the tabs API is preserved
 *
 * @param tab The Chrome tab to extract favicon from
 * @returns Link data object with preserved favicon
 */
export async function createLinkDataFromTab(tab: ChromeTabInfo): Promise<{
  title: string;
  url: string;
  favIconUrl: string;
}> {
  // Use the favicon from the tab directly (highest quality)
  let faviconUrl = tab.favIconUrl || '';

  // If no favicon in tab, preload it using our improved service
  if (!faviconUrl && tab.url) {
    faviconUrl = await preloadFavicon(tab.url);
  }

  return {
    title: tab.title || 'Untitled Link',
    url: tab.url,
    favIconUrl: faviconUrl,
  };
}

/**
 * Updates a link's favicon when its URL changes
 * This ensures the favicon stays up-to-date with the new URL
 *
 * @param url The new URL
 * @returns Promise resolving to the new favicon URL
 */
export async function updateFaviconForUrl(url: string): Promise<string> {
  return await preloadFavicon(url);
}

/**
 * Batch process multiple URLs to preload their favicons
 * Useful when importing multiple bookmarks or tabs at once
 *
 * @param urls Array of URLs to preload favicons for
 * @returns Promise resolving to a map of URLs to favicon URLs
 */
export async function batchPreloadFavicons(
  urls: string[]
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  // Process URLs in parallel with a limit to avoid overwhelming the browser
  const batchSize = 5;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (url) => {
        try {
          results[url] = await preloadFavicon(url);
        } catch (error) {
          console.error(`Failed to preload favicon for ${url}:`, error);
          results[url] = '';
        }
      })
    );
  }

  return results;
}
