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
    // Initial load of Chrome windows
    const loadInitialData = async () => {
      try {
        const windows = await getAllWindows();
        setChromeWindows(windows);
      } catch (error) {
        console.error('Error loading initial Chrome windows:', error);
      }
    };

    loadInitialData();

    // Set up real-time monitoring
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
