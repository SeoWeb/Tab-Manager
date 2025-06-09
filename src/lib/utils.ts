import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getInitials(name: string): string {
  if (!name) return "";
  const words = name.split(" ").filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + (words[words.length-1][0] || '')).toUpperCase();
}

export function isValidUrl(string: string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;  
  }
}

export function getFaviconUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    // Using Google's favicon service as a reliable option.
    // sz=32 for 32x32 pixels, adjust if needed.
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
  } catch (error) {
    // Fallback or default icon if URL is invalid or hostname can't be extracted
    // console.error("Error generating favicon URL:", error);
    // For simplicity, returning a placeholder or a generic icon path
    return `https://placehold.co/32x32.png`; // Placeholder
  }
}
