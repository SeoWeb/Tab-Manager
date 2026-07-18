import type { ChromeTabInfo } from '@/types';
import { showErrorToast } from '../toast';
import { isExtensionContext, mapTabToChromeTabInfo } from './context';

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

    return mapTabToChromeTabInfo(tab, windowId || 0);
  } catch (error) {
    console.error('Error creating tab:', error);
    if (error instanceof Error) {
      showErrorToast(`Error creating tab: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while creating the tab.');
    }
    return null;
  }
};

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
    if (error instanceof Error) {
      showErrorToast(`Error closing tab: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while closing the tab.');
    }
    return false;
  }
};

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
    if (error instanceof Error) {
      showErrorToast(`Error moving tab: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while moving the tab.');
    }
    return false;
  }
};
