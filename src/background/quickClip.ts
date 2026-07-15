// src/background/quickClip.ts
//
// "Save to TabSpace" context menu. Runs entirely in the extension service
// worker: a right-click on a page/link clips it into the top-level Quick Clips
// storage WITHOUT opening a new tab or popup. The Quick Clips panel (UI) reads
// the same storage key to display the clips.

import { nanoid } from 'nanoid';
import {
  QUICK_CLIPS_STORAGE_KEY,
  addQuickClip,
  resolveClipFromContext,
  type QuickClip,
} from '@/lib/quickClips';

const MENU_ID = 'save-to-tabspace';
const MENU_TITLE = 'Save to TabSpace';

/** Create (or recreate idempotently) the context menu entry. */
export function registerQuickClipMenu(): void {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;
  // Context menus persist across SW restarts, but re-creating on install/boot
  // is the recommended pattern and is safe.
  chrome.contextMenus.remove(MENU_ID, () => {
    // Ignore the "not found" error on first run.
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: MENU_TITLE,
        contexts: ['page', 'link'],
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
}

/** Briefly flash the toolbar icon badge as save confirmation. */
function flashBadge(): void {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }, () => {
    void chrome.runtime.lastError;
  });
  chrome.action.setBadgeText({ text: '✓' }, () => {
    void chrome.runtime.lastError;
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }, () => {
        void chrome.runtime.lastError;
      });
    }, 1200);
  });
}

/**
 * Context menu click handler. Resolves the URL/title, persists the clip, and
 * flashes the badge. Never opens a tab.
 */
export async function onQuickClipClicked(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  const resolved = resolveClipFromContext(info, tab);
  if (!resolved) return; // Non-savable URL (chrome://, etc.)

  const clip: QuickClip = {
    id: nanoid(),
    title: resolved.title,
    url: resolved.url,
    favIconUrl: resolved.favIconUrl,
    createdAt: new Date().toISOString(),
  };

  try {
    await addQuickClip(clip);
    flashBadge();
  } catch (error) {
    console.error('[quick-clip] failed to save clip', error);
  }
}

export { QUICK_CLIPS_STORAGE_KEY };
