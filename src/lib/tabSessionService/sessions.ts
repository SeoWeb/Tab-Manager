import type { ChromeWindowInfo } from '@/types';
import { getAllWindows, createWindow } from '../tabService';
import { showErrorToast, showSuccessToast } from '../toast';

export interface TabSession {
  id: string;
  name: string;
  timestamp: number;
  windows: ChromeWindowInfo[];
  totalTabs: number;
}

export const STORAGE_KEY = 'tab_sessions';
export const CURRENT_SESSION_KEY = 'current_tab_session';
export const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export const isExtensionContext = (): boolean => {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
};

export const generateSessionId = (): string => {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

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
