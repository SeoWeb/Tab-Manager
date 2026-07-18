import type { ChromeTabInfo } from '@/types';
import { showErrorToast } from '../toast';
import { isExtensionContext, mapTabToChromeTabInfo } from './context';

export const setupTabMonitoring = (
  onTabCreated: (tab: ChromeTabInfo) => void,
  onTabRemoved: (tabId: number, windowId: number) => void,
  onTabUpdated: (tabId: number, tab: ChromeTabInfo) => void
): (() => void) => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available for monitoring');
    return () => {};
  }

  const handleTabCreated = (tab: chrome.tabs.Tab) => {
    onTabCreated(mapTabToChromeTabInfo(tab, 0));
  };

  const handleTabRemoved = (
    tabId: number,
    removeInfo: { windowId: number }
  ) => {
    onTabRemoved(tabId, removeInfo.windowId);
  };

  const handleTabUpdated = (
    tabId: number,
    changeInfo: { title?: string; url?: string; favIconUrl?: string },
    tab: chrome.tabs.Tab
  ) => {
    // Only notify on meaningful updates
    if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) {
      onTabUpdated(tabId, mapTabToChromeTabInfo(tab, 0));
    }
  };

  // Add listeners
  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);

  // Return cleanup function
  return () => {
    chrome.tabs.onCreated.removeListener(handleTabCreated);
    chrome.tabs.onRemoved.removeListener(handleTabRemoved);
    chrome.tabs.onUpdated.removeListener(handleTabUpdated);
  };
};

export const checkTabsPermission = async (): Promise<boolean> => {
  if (!isExtensionContext()) {
    return false;
  }

  try {
    return await chrome.permissions.contains({
      permissions: ['tabs'],
    });
  } catch (error) {
    console.error('Error checking tabs permission:', error);
    showErrorToast('Error checking tabs permission.');
    return false;
  }
};
