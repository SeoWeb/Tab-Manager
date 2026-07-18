import { getAllWindows, createWindow } from '../tabService';
import { showSuccessToast } from '../toast';
import {
  isExtensionContext,
  CURRENT_SESSION_KEY,
  AUTO_SAVE_INTERVAL,
} from './sessions';

export const autoSaveCurrentSession = async (): Promise<void> => {
  if (!isExtensionContext()) {
    return;
  }

  try {
    const windows = await getAllWindows();

    if (windows.length === 0) {
      // If no tabs are open, clear the current session
      chrome.storage.local.remove([CURRENT_SESSION_KEY]);
      return;
    }

    const currentSession = {
      timestamp: Date.now(),
      windows,
    };

    chrome.storage.local.set({ [CURRENT_SESSION_KEY]: currentSession });
  } catch (error) {
    console.error('Error auto-saving current session:', error);
  }
};

export const restoreLastSession = async (): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome storage not available');
    return false;
  }

  try {
    return new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_SESSION_KEY], async (result) => {
        const lastSession = result[CURRENT_SESSION_KEY];

        if (
          !lastSession ||
          !lastSession.windows ||
          lastSession.windows.length === 0
        ) {
          resolve(false);
          return;
        }

        try {
          // Check if session is recent (within last 24 hours)
          const sessionAge = Date.now() - lastSession.timestamp;
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours

          if (sessionAge > maxAge) {
            // Session is too old, don't restore
            chrome.storage.local.remove([CURRENT_SESSION_KEY]);
            resolve(false);
            return;
          }

          // Restore the session
          for (const windowData of lastSession.windows) {
            if (windowData.tabs.length > 0) {
              const urls = windowData.tabs
                .map((tab: { url: string }) => tab.url)
                .filter((url: string) => url && url !== '');

              if (urls.length > 0) {
                await createWindow(urls);
              }
            }
          }

          showSuccessToast('Previous session restored.');
          resolve(true);
        } catch (error) {
          console.error('Error restoring last session:', error);
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.error('Error restoring last session:', error);
    return false;
  }
};

export const checkForSessionRestore = async (): Promise<boolean> => {
  if (!isExtensionContext()) {
    return false;
  }

  try {
    // Check if there are currently any open tabs
    const currentWindows = await getAllWindows();
    const hasOpenTabs = currentWindows.some((window) => window.tabs.length > 0);

    // If there are already open tabs, don't auto-restore
    if (hasOpenTabs) {
      return false;
    }

    // Try to restore the last session
    return await restoreLastSession();
  } catch (error) {
    console.error('Error checking for session restore:', error);
    return false;
  }
};

export const startAutoSaveMonitoring = (): (() => void) => {
  if (!isExtensionContext() || typeof window === 'undefined') {
    return () => {};
  }

  // Defer initial auto-save to avoid blocking startup
  setTimeout(autoSaveCurrentSession, 1000);

  // Set up interval for auto-saving
  const intervalId = setInterval(autoSaveCurrentSession, AUTO_SAVE_INTERVAL);

  // Set up listeners for tab changes with better debouncing
  let debounceTimeout: NodeJS.Timeout | null = null;
  const handleTabChange = () => {
    // Clear existing timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    // Debounce the auto-save to avoid too frequent saves
    debounceTimeout = setTimeout(autoSaveCurrentSession, 2000);
  };

  if (chrome.tabs) {
    chrome.tabs.onCreated.addListener(handleTabChange);
    chrome.tabs.onRemoved.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);
  }

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    if (chrome.tabs) {
      chrome.tabs.onCreated.removeListener(handleTabChange);
      chrome.tabs.onRemoved.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabChange);
    }
  };
};
