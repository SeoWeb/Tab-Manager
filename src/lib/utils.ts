import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  getFaviconUrl as getFaviconUrlFromService,
  preloadFavicon as preloadFaviconFromService,
} from './faviconService';

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

/**
 * Wrapper function for the improved favicon service
 * Maintains backward compatibility with existing code
 */
export async function getFaviconUrl(url: string): Promise<string> {
  return await getFaviconUrlFromService(url);
}

/**
 * Preloads and caches favicon for a URL
 * Useful when adding new links from tabs to preserve high-quality favicons
 */
export async function preloadFavicon(url: string): Promise<string> {
  return await preloadFaviconFromService(url);
}
