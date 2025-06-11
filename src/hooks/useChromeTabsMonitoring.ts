/**
 * Hook for monitoring Chrome tabs in real-time
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { setupTabMonitoring, getAllWindows } from '@/lib/tabService';
import type { ChromeTabInfo } from '@/types';

export const useChromeTabsMonitoring = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const {
    refreshChromeWindows,
    addChromeTab,
    removeChromeTab,
    updateChromeTab,
    setChromeWindows,
  } = useAppStore();

  useEffect(() => {
    // Set up real-time monitoring first (lightweight)
    const cleanup = setupTabMonitoring(
      // onTabCreated
      (tab: ChromeTabInfo) => {
        console.log('Tab created:', tab);
        addChromeTab(tab.windowId, tab);
      },
      // onTabRemoved
      (tabId: number, windowId: number) => {
        console.log('Tab removed:', tabId, 'from window:', windowId);
        removeChromeTab(tabId);
      },
      // onTabUpdated
      (tabId: number, tab: ChromeTabInfo) => {
        console.log('Tab updated:', tabId, tab);
        updateChromeTab(tabId, tab);
      }
    );

    cleanupRef.current = cleanup;

    // Defer initial data load to avoid blocking UI
    setTimeout(async () => {
      try {
        const windows = await getAllWindows();
        setChromeWindows(windows);
      } catch (error) {
        console.error('Error loading initial Chrome windows:', error);
      }
    }, 300);

    // Cleanup on unmount
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [addChromeTab, removeChromeTab, updateChromeTab, setChromeWindows]);

  // Manual refresh function
  const refreshTabs = async () => {
    try {
      await refreshChromeWindows();
    } catch (error) {
      console.error('Error refreshing Chrome tabs:', error);
    }
  };

  return {
    refreshTabs,
  };
};
