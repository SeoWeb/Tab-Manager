import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
// import { extractFavicon } from './faviconService';
import { setCachedFavicon } from './cacheService';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name: string): string {
  if (!name) return '';
  const words = name.split(' ').filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + (words[words.length - 1][0] || '')).toUpperCase();
}

export function isValidUrl(string: string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

export function getFullUrl(url: string): string {
  // Ensure the URL has a protocol
  let urlWithProtocol = url;
  if (!/^https?:\/\//i.test(url)) {
    urlWithProtocol = `https://${url}`;
  }

  const urlObject = new URL(urlWithProtocol);
  return urlObject.href;
}

function getGoogleFavicon(hostname: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return `https://placehold.co/32x32.png`;
  }
}

async function getTabsFavicon(url: string): Promise<string | null> {
  try {
    // First try Chrome tabs API
    const tabs = await chrome.tabs.query({ url: getFullUrl(url) });
    console.log(tabs, getFullUrl(url));
    if (tabs[0]?.favIconUrl) {
      return tabs[0].favIconUrl;
    }
  } catch (e) {
    console.error(e);
  }

  return null;
}

function getFaviconFromCache(url: string): string {
  const domain = new URL(getFullUrl(url)).origin;
  return `chrome://favicon/size/16@1x/${domain}`;
}

export async function getFaviconUrl(url: string) {
  let domain = url;
  try {
    const urlObject = new URL(url);
    domain = urlObject.hostname;
  } catch (e) {
    console.log(e);
  }

  let favicon = null;

  // favicon = await getCachedFavicon(domain);
  // if (favicon) {
  //   return favicon;
  // }

  favicon = await getTabsFavicon(domain);
  if (favicon) {
    await setCachedFavicon(domain, favicon);
    return favicon;
  }

  // favicon = await extractFavicon(domain);
  // if (favicon) {
  //   await setCachedFavicon(domain, favicon);
  //   return favicon;
  // }

  favicon = getFaviconFromCache(domain);
  await setCachedFavicon(domain, favicon);
  if (favicon) {
    return favicon;
  }

  // Fallback to Google's service
  favicon = getGoogleFavicon(domain);
  await setCachedFavicon(domain, favicon);

  return favicon;
}
