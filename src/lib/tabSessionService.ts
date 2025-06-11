/**
 * Tab Session Service
 * Handles saving and restoring Chrome tab sessions
 */

import type { ChromeTabInfo, ChromeWindowInfo } from '@/types';
import { getAllWindows, createWindow } from './tabService';
import { showErrorToast, showSuccessToast } from './toast';

export interface TabSession {
  id: string;
  name: string;
  timestamp: number;
  windows: ChromeWindowInfo[];
  totalTabs: number;
}

const STORAGE_KEY = 'tab_sessions';
const CURRENT_SESSION_KEY = 'current_tab_session';
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

// Check if we're running in a Chrome extension context
const isExtensionContext = (): boolean => {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
};

/**
 * Generate a unique session ID
 */
const generateSessionId = (): string => {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get all saved tab sessions
 */
export const getSavedSessions = async (): Promise<TabSession[]> => {
  if (!isExtensionContext()) {
    console.warn('Chrome storage not available');
    return [];
  }

  try {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const sessions = result[STORAGE_KEY] || [];
        resolve(sessions);
      });
    });
  } catch (error) {
    console.error('Error getting saved sessions:', error);
    showErrorToast('Error loading saved sessions.');
    return [];
  }
};

/**
 * Save current tab session
 */
export const saveCurrentSession = async (
  name?: string
): Promise<TabSession | null> => {
  if (!isExtensionContext()) {
    console.warn('Chrome storage not available');
    return null;
  }

  try {
    const windows = await getAllWindows();

    if (windows.length === 0) {
      showErrorToast('No open tabs to save.');
      return null;
    }

    const totalTabs = windows.reduce(
      (sum, window) => sum + window.tabs.length,
      0
    );

    const session: TabSession = {
      id: generateSessionId(),
      name: name || `Session ${new Date().toLocaleString()}`,
      timestamp: Date.now(),
      windows,
      totalTabs,
    };

    const existingSessions = await getSavedSessions();
    const updatedSessions = [...existingSessions, session];

    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updatedSessions }, () => {
        showSuccessToast(`Session "${session.name}" saved successfully.`);
        resolve(session);
      });
    });
  } catch (error) {
    console.error('Error saving current session:', error);
    showErrorToast('Error saving current session.');
    return null;
  }
};

/**
 * Restore a saved session
 */
export const restoreSession = async (sessionId: string): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome storage not available');
    return false;
  }

  try {
    const sessions = await getSavedSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      showErrorToast('Session not found.');
      return false;
    }

    // Create windows and tabs from the session
    for (const windowData of session.windows) {
      if (windowData.tabs.length > 0) {
        const urls = windowData.tabs
          .map((tab) => tab.url)
          .filter((url) => url && url !== '');

        if (urls.length > 0) {
          await createWindow(urls);
        }
      }
    }

    showSuccessToast(`Session "${session.name}" restored successfully.`);
    return true;
  } catch (error) {
    console.error('Error restoring session:', error);
    showErrorToast('Error restoring session.');
    return false;
  }
};

/**
 * Delete a saved session
 */
export const deleteSession = async (sessionId: string): Promise<boolean> => {
  if (!isExtensionContext()) {
    console.warn('Chrome storage not available');
    return false;
  }

  try {
    const sessions = await getSavedSessions();
    const updatedSessions = sessions.filter((s) => s.id !== sessionId);

    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updatedSessions }, () => {
        showSuccessToast('Session deleted successfully.');
        resolve(true);
      });
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    showErrorToast('Error deleting session.');
    return false;
  }
};

/**
 * Auto-save current session (for background persistence)
 */
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

/**
 * Restore the last auto-saved session
 */
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
                .map((tab: ChromeTabInfo) => tab.url)
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

/**
 * Start auto-save monitoring
 */
export const startAutoSaveMonitoring = (): (() => void) => {
  if (!isExtensionContext() || typeof window === 'undefined') {
    return () => {};
  }

  // Auto-save immediately
  autoSaveCurrentSession();

  // Set up interval for auto-saving
  const intervalId = setInterval(autoSaveCurrentSession, AUTO_SAVE_INTERVAL);

  // Set up listeners for tab changes to trigger immediate auto-save
  const handleTabChange = () => {
    // Debounce the auto-save to avoid too frequent saves
    setTimeout(autoSaveCurrentSession, 1000);
  };

  if (chrome.tabs) {
    chrome.tabs.onCreated.addListener(handleTabChange);
    chrome.tabs.onRemoved.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);
  }

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
    if (chrome.tabs) {
      chrome.tabs.onCreated.removeListener(handleTabChange);
      chrome.tabs.onRemoved.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabChange);
    }
  };
};

/**
 * Check if there's a session to restore on startup
 */
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
