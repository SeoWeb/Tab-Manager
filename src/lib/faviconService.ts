import { showErrorToast } from './toast';

/**
 * Extracts the best possible favicon URL from a given webpage URL.
 *
 * This function fetches the page's HTML, parses it to find all specified favicons,
 * and selects the best one based on quality and type. It handles relative URLs
 * and falls back to common favicon locations if none are specified in the HTML.
 *
 * @param pageUrl The URL of the page to extract the favicon from.
 * @returns A promise that resolves to the URL of the best favicon, or a default placeholder if none is found.
 */
export async function extractFavicon(pageUrl: string): Promise<string> {
  const defaultFavicon = `https://www.google.com/s2/favicons?domain=${new URL(pageUrl).hostname}&sz=32`;

  try {
    const response = await fetch(pageUrl);
    if (!response.ok) {
      return defaultFavicon;
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(
      doc.querySelectorAll<HTMLLinkElement>("link[rel*='icon']")
    );

    if (links.length === 0) {
      // Fallback to checking for /favicon.ico
      try {
        const faviconUrl = new URL('/favicon.ico', pageUrl).href;
        const faviconResponse = await fetch(faviconUrl);
        if (faviconResponse.ok) {
          return faviconUrl;
        }
      } catch {
        // Ignore error and return default
      }
      return defaultFavicon;
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

    return new URL(bestIcon.href, pageUrl).href;
  } catch (error) {
    console.error(`Failed to extract favicon for ${pageUrl}:`, error);
    showErrorToast(`Failed to extract favicon for ${pageUrl}`);
    return defaultFavicon;
  }
}
