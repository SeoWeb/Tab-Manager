import type { ChromeWindowInfo } from '@/types';
import { showErrorToast } from '../toast';
import { isExtensionContext } from './context';
import { getWindowTabs } from './queries';

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

    if (!window?.id) {
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
    if (error instanceof Error) {
      showErrorToast(`Error creating window: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while creating the window.');
    }
    return null;
  }
};

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
    if (error instanceof Error) {
      showErrorToast(`Error focusing window: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while focusing the window.');
    }
    return false;
  }
};

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
    if (error instanceof Error) {
      showErrorToast(`Error switching to tab: ${error.message}`);
    } else {
      showErrorToast('An unknown error occurred while switching to the tab.');
    }
    return false;
  }
};
