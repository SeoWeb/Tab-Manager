/**
 * Chrome Tabs API Service
 * Provides utilities for interacting with Chrome's tabs API
 */

import type { ChromeTabInfo, ChromeWindowInfo } from '@/types';

// Check if we're running in a Chrome extension context
const isExtensionContext = (): boolean => {
  return typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.windows;
};

/**
 * Get all Chrome windows with their tabs
 */
export const getAllWindows = async (): Promise<ChromeWindowInfo[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available - using mock data');
    return [];
  }

  try {
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });

    return windows.map((window, index) => ({
      id: window.id || index,
      name: `Window ${window.id || index + 1}`,
      isFocused: window.focused,
      type: window.type,
      tabs: (window.tabs || []).map((tab) => ({
        id: tab.id || 0,
        title: tab.title || 'Untitled',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl,
        windowId: window.id || index,
      })),
    }));
  } catch (error) {
    console.error('Error fetching Chrome windows:', error);
    return [];
  }
};

/**
 * Get tabs from a specific window
 */
export const getWindowTabs = async (
  windowId: number
): Promise<ChromeTabInfo[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return [];
  }

  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.map((tab) => ({
      id: tab.id || 0,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId || windowId,
    }));
  } catch (error) {
    console.error('Error fetching window tabs:', error);
    return [];
  }
};

/**
 * Get all tabs across all windows
 */
export const getAllTabs = async (): Promise<ChromeTabInfo[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return [];
  }

  try {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id || 0,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId || 0,
    }));
  } catch (error) {
    console.error('Error fetching all tabs:', error);
    return [];
  }
};

/**
 * Create a new tab
 */
export const createTab = async (
  url: string,
  windowId?: number
): Promise<ChromeTabInfo | null> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return null;
  }

  try {
    const tab = await chrome.tabs.create({
      url,
      windowId,
      active: false,
    });

    return {
      id: tab.id || 0,
      title: tab.title || 'Loading...',
      url: tab.url || url,
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId || windowId || 0,
    };
  } catch (error) {
    console.error('Error creating tab:', error);
    return null;
  }
};

/**
 * Close a tab
 */
export const closeTab = async (tabId: number): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return false;
  }

  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch (error) {
    console.error('Error closing tab:', error);
    return false;
  }
};

/**
 * Move tab to a different window
 */
export const moveTabToWindow = async (
  tabId: number,
  windowId: number
): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return false;
  }

  try {
    await chrome.tabs.move(tabId, { windowId, index: -1 });
    return true;
  } catch (error) {
    console.error('Error moving tab:', error);
    return false;
  }
};

/**
 * Create a new window with specified tabs
 */
export const createWindow = async (
  urls: string[]
): Promise<ChromeWindowInfo | null> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return null;
  }

  try {
    const window = await chrome.windows.create({
      url: urls,
      focused: true,
      type: 'normal',
    });

    if (!window.id) {
      throw new Error('Failed to create window');
    }

    const tabs = await getWindowTabs(window.id);

    return {
      id: window.id,
      name: `Window ${window.id}`,
      isFocused: window.focused,
      type: window.type,
      tabs,
    };
  } catch (error) {
    console.error('Error creating window:', error);
    return null;
  }
};

/**
 * Focus a specific window
 */
export const focusWindow = async (windowId: number): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return false;
  }

  try {
    await chrome.windows.update(windowId, { focused: true });
    return true;
  } catch (error) {
    console.error('Error focusing window:', error);
    return false;
  }
};

/**
 * Switch to a specific tab
 */
export const switchToTab = async (tabId: number): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    return true;
  } catch (error) {
    console.error('Error switching to tab:', error);
    return false;
  }
};

/**
 * Check if a URL already exists in open tabs
 */
export const findTabByUrl = async (
  url: string
): Promise<ChromeTabInfo | null> => {
  if (!isExtensionContext()) {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      const tab = tabs[0];
      return {
        id: tab.id || 0,
        title: tab.title || 'Untitled',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl,
        windowId: tab.windowId || 0,
      };
    }
    return null;
  } catch (error) {
    console.error('Error finding tab by URL:', error);
    return null;
  }
};

/**
 * Set up real-time tab monitoring
 */
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
    onTabCreated({
      id: tab.id || 0,
      title: tab.title || 'Loading...',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId || 0,
    });
  };

  const handleTabRemoved = (
    tabId: number,
    removeInfo: chrome.tabs.TabRemoveInfo
  ) => {
    onTabRemoved(tabId, removeInfo.windowId);
  };

  const handleTabUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => {
    // Only notify on meaningful updates
    if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) {
      onTabUpdated(tabId, {
        id: tab.id || 0,
        title: tab.title || 'Loading...',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl,
        windowId: tab.windowId || 0,
      });
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

/**
 * Utility to check if extension has necessary permissions
 */
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
    return false;
  }
};
