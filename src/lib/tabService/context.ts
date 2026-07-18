import type { ChromeTabInfo, ChromeWindowInfo } from '@/types';

export const isExtensionContext = (): boolean => {
  return typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.windows;
};

export const mapTabToChromeTabInfo = (
  tab: chrome.tabs.Tab,
  fallbackWindowId: number
): ChromeTabInfo => ({
  id: tab.id || 0,
  title: tab.title || 'Loading...',
  url: tab.url || '',
  favIconUrl: tab.favIconUrl,
  windowId: tab.windowId || fallbackWindowId,
});

export const mapWindow = (
  window: chrome.windows.Window,
  index: number
): ChromeWindowInfo => ({
  id: window.id || index,
  name: `Window ${window.id || index + 1}`,
  isFocused: window.focused,
  type: window.type,
  tabs: (window.tabs || []).map((tab) =>
    mapTabToChromeTabInfo(tab, window.id || index)
  ),
});
