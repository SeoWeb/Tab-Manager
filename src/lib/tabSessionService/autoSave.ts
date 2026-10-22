import { getAllWindows, createWindow } from '../tabService';
import { showSuccessToast } from '../toast';
import {
  isExtensionContext,
  CURRENT_SESSION_KEY,
  AUTO_SAVE_INTERVAL,
} from './sessions';

/**
 * Messages page contexts (popup/newtab) send to the background worker. The
 * worker is the single writer for `current_tab_session`; pages must not touch
 * session storage themselves (fix-cross-context-data-loss §4).
 */
export const SAVE_TAB_SESSION_MESSAGE_TYPE = 'save-tab-session';
export const RESTORE_TAB_SESSION_MESSAGE_TYPE = 'restore-tab-session';

export interface TabSessionMessageResponse {
  ok: boolean;
  restored?: boolean;
}

/**
 * True only in the MV3 service worker. The worker is the one extension context
 * without a `document` (every extension page has one) — the same convention
 * `cloudflareSync/syncLock.ts` uses. `isExtensionContext()` additionally keeps
 * the plain-web build (no chrome APIs) out of "worker mode".
 */
export const isWorkerContext = (): boolean =>
  isExtensionContext() && typeof document === 'undefined';

/**
 * Send a tab-session request to the background worker and await its reply.
 * Resolves `null` when the worker is unreachable (`chrome.runtime.lastError`,
 * e.g. the worker was torn down or the extension reloaded) — callers log and
 * give up; they must NOT fall back to writing session storage themselves
 * (single-writer rule for the session key).
 */
const sendTabSessionMessage = (
  messageType: string
): Promise<TabSessionMessageResponse | null> => {
  return new Promise((resolve) => {
    if (!isExtensionContext()) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: messageType }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            `Tab-session worker unreachable (${messageType}):`,
            chrome.runtime.lastError.message
          );
          resolve(null);
          return;
        }
        resolve(response as TabSessionMessageResponse);
      });
    } catch (error) {
      // e.g. "Extension context invalidated" while the page is going away.
      console.warn(`Error sending ${messageType} to the worker:`, error);
      resolve(null);
    }
  });
};

export const autoSaveCurrentSession = async (): Promise<void> => {
  if (!isExtensionContext()) {
    return;
  }

  // Page contexts delegate the write to the background worker so exactly one
  // writer exists for the session key (§4: pages never touch session storage).
  if (!isWorkerContext()) {
    const response = await sendTabSessionMessage(SAVE_TAB_SESSION_MESSAGE_TYPE);
    if (response && !response.ok) {
      console.warn('Background worker failed to save the current session');
    }
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

/** In-flight eligibility check, so concurrent requests share one run. */
let sessionRestoreCheck: Promise<boolean> | null = null;

/**
 * The worker-side eligibility check: only restore when no normal windows are
 * open. Runs exclusively in the service worker (see `checkForSessionRestore`).
 */
const runSessionRestoreCheck = async (): Promise<boolean> => {
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

export const checkForSessionRestore = async (): Promise<boolean> => {
  if (!isExtensionContext()) {
    return false;
  }

  // Session-restore eligibility runs in the worker only (§4); pages ask the
  // worker to check. If the worker is unreachable this resolves false without
  // touching storage (log, don't write).
  if (!isWorkerContext()) {
    const response = await sendTabSessionMessage(
      RESTORE_TAB_SESSION_MESSAGE_TYPE
    );
    return response?.restored === true;
  }

  // Serialise eligibility checks: two pages delegating at once (or a page
  // racing the worker's own onStartup check) must not both observe "no open
  // tabs" and restore the session twice — that would open duplicate windows.
  if (!sessionRestoreCheck) {
    sessionRestoreCheck = runSessionRestoreCheck();
  }
  const check = sessionRestoreCheck;
  return check.finally(() => {
    if (sessionRestoreCheck === check) {
      sessionRestoreCheck = null;
    }
  });
};

export const startAutoSaveMonitoring = (): (() => void) => {
  // Auto-save is worker-owned (§4): only the service worker may register the
  // tab listeners and the periodic save, keeping exactly one auto-saver no
  // matter how many popup/newtab contexts are open.
  if (!isWorkerContext()) {
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
