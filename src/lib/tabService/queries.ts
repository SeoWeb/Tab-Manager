import type { ChromeTabInfo, ChromeWindowInfo } from '@/types';
import { showErrorToast } from '../toast';
import {
  isExtensionContext,
  mapTabToChromeTabInfo,
  mapWindow,
} from './context';

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

    return windows.map((window, index) => mapWindow(window, index));
  } catch (error) {
    console.error('Error fetching Chrome windows:', error);
    showErrorToast('Error fetching Chrome windows.');
    return [];
  }
};

export const getWindowTabs = async (
  windowId: number
): Promise<ChromeTabInfo[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return [];
  }

  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.map((tab) => mapTabToChromeTabInfo(tab, windowId));
  } catch (error) {
    console.error('Error fetching window tabs:', error);
    showErrorToast('Error fetching window tabs.');
    return [];
  }
};

export const getAllTabs = async (): Promise<ChromeTabInfo[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome tabs API not available');
    return [];
  }

  try {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => mapTabToChromeTabInfo(tab, 0));
  } catch (error) {
    console.error('Error fetching all tabs:', error);
    showErrorToast('Error fetching all tabs.');
    return [];
  }
};

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
      return mapTabToChromeTabInfo(tab, 0);
    }
    return null;
  } catch (error) {
    console.error('Error finding tab by URL:', error);
    showErrorToast('Error finding tab by URL.');
    return null;
  }
};
