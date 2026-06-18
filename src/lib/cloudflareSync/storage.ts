// Low-level helpers for reading/writing JSON values in chrome.storage.local.
//
// Everything the sync client persists (token, account, queue, cursors, client id,
// api base url) lives in its own chrome.storage.local key, separate from the
// Zustand-persisted store. chrome.storage.local stores structured-cloneable
// values directly, so we store objects as-is rather than stringifying.

export const CLOUD_SYNC_STORAGE_KEYS = {
  token: 'cloud-sync-token',
  account: 'cloud-sync-account',
  apiBaseUrl: 'cloud-sync-api-base-url',
  clientId: 'cloud-sync-client-id',
  queue: 'cloud-sync-mutation-queue',
  /** Phase 5 advisory lock preventing concurrent popup/background syncs. */
  syncLock: 'cloud-sync-lock',
} as const;

export type CloudSyncStorageKey =
  (typeof CLOUD_SYNC_STORAGE_KEYS)[keyof typeof CLOUD_SYNC_STORAGE_KEYS];

function isChromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
}

/** Read a value from chrome.storage.local, falling back when unavailable. */
export function readJson<T>(key: CloudSyncStorageKey, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) {
      resolve(fallback);
      return;
    }
    chrome.storage.local.get([key], (result) => {
      const value = result[key];
      resolve(value === undefined ? fallback : (value as T));
    });
  });
}

/** Write a value to chrome.storage.local. */
export function writeJson<T>(
  key: CloudSyncStorageKey,
  value: T
): Promise<void> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) {
      resolve();
      return;
    }
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

/** Remove a value from chrome.storage.local. */
export function removeKey(key: CloudSyncStorageKey): Promise<void> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) {
      resolve();
      return;
    }
    chrome.storage.local.remove([key], () => resolve());
  });
}
