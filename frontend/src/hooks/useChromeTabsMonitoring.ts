/**
 * Web stub for the Chrome tabs real-time monitoring hook.
 *
 * Same export name (`useChromeTabsMonitoring`) and return shape
 * (`{ refreshTabs }`) as the extension hook. With no `chrome.tabs` events on the
 * web, it is a no-op. The web AppClient does not invoke it (it skips
 * Chrome-only init), so this exists only to keep the module resolvable.
 */
import { useEffect } from 'react';

export const useChromeTabsMonitoring = () => {
  useEffect(() => {
    // No chrome.tabs.* listeners to register in a browser tab.
  }, []);

  return {
    refreshTabs: async () => {},
  };
};
