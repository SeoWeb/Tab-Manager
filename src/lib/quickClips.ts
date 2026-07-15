// src/lib/quickClips.ts
//
// Top-level "Quick Clips" storage, kept OUT of the project/collection model.
// Clips saved via the "Save to TabSpace" context menu (service worker) and
// consumed by the right-sidebar Quick Clips panel. Pure chrome.storage access,
// DOM-free, so it can be imported from both the UI and the background bundle.

export const QUICK_CLIPS_STORAGE_KEY = 'tabspace-quick-clips';

export interface QuickClip {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  /** ISO string timestamp of when the clip was created. */
  createdAt: string;
}

function isChromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
}

function readRaw(): Promise<QuickClip[] | null> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve(null);
    chrome.storage.local.get([QUICK_CLIPS_STORAGE_KEY], (result) => {
      const value = result?.[QUICK_CLIPS_STORAGE_KEY];
      if (Array.isArray(value)) {
        resolve(value as QuickClip[]);
      } else {
        resolve(null);
      }
    });
  });
}

function writeRaw(clips: QuickClip[]): Promise<void> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve();
    chrome.storage.local.set({ [QUICK_CLIPS_STORAGE_KEY]: clips }, () =>
      resolve()
    );
  });
}

/** Returns the current list of clips (newest first). */
export async function getQuickClips(): Promise<QuickClip[]> {
  const clips = await readRaw();
  if (!clips) return [];
  // Newest first for display convenience.
  return [...clips].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

/** Prepends a clip to the list (dedupes by normalized URL). */
export async function addQuickClip(clip: QuickClip): Promise<void> {
  const clips = (await readRaw()) ?? [];
  const normalized = clip.url?.trim().toLowerCase();
  if (
    normalized &&
    clips.some((c) => c.url?.trim().toLowerCase() === normalized)
  ) {
    return; // Already clipped; avoid duplicates.
  }
  await writeRaw([clip, ...clips]);
}

/** Removes a clip by id. No-op if it isn't present. */
export async function removeQuickClip(id: string): Promise<void> {
  const clips = (await readRaw()) ?? [];
  const next = clips.filter((c) => c.id !== id);
  if (next.length !== clips.length) {
    await writeRaw(next);
  }
}

/**
 * Subscribes to clip changes. Returns an unsubscribe function. Fires immediately
 * with the current list, then on every change to the storage key.
 */
export function subscribeQuickClips(
  callback: (clips: QuickClip[]) => void
): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (!(QUICK_CLIPS_STORAGE_KEY in changes)) return;
    const value = changes[QUICK_CLIPS_STORAGE_KEY]?.newValue;
    callback(Array.isArray(value) ? (value as QuickClip[]) : []);
  };
  if (isChromeStorageAvailable()) {
    chrome.storage.onChanged.addListener(handler);
    // Emit the current value right away.
    void getQuickClips().then(callback);
  }
  return () => {
    if (isChromeStorageAvailable()) {
      chrome.storage.onChanged.removeListener(handler);
    }
  };
}

/**
 * Pure helper: resolve the target URL + title from a context-menu click.
 * Extracted so it can be unit-tested without a live service worker.
 *
 * @returns null when there is no savable URL (e.g. chrome://, about:, data:).
 */
export function resolveClipFromContext(
  info: {
    linkUrl?: string;
    pageUrl?: string;
    frameUrl?: string;
    selectionText?: string;
  },
  tab?: { url?: string; title?: string; favIconUrl?: string }
): { url: string; title: string; favIconUrl?: string } | null {
  const url =
    info.linkUrl?.trim() ||
    info.pageUrl?.trim() ||
    info.frameUrl?.trim() ||
    tab?.url?.trim() ||
    '';
  if (!url) return null;

  // Skip internal / non-web URLs that can't be opened or clipped meaningfully.
  const lower = url.toLowerCase();
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('about:') ||
    lower.startsWith('data:') ||
    lower.startsWith('edge://') ||
    lower.startsWith('moz-extension://') ||
    lower.startsWith('file://')
  ) {
    return null;
  }

  const title = info.selectionText?.trim() || tab?.title?.trim() || url;

  return {
    url,
    title,
    favIconUrl: tab?.favIconUrl?.trim() || undefined,
  };
}
