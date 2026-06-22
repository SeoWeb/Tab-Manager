import { get, set, del } from 'idb-keyval';

/**
 * Web replacement for the extension's `chrome.storage.local` cloud-sync
 * helpers. Same export surface (`CLOUD_SYNC_STORAGE_KEYS`, `readJson`,
 * `writeJson`, `removeKey`) so `config.ts`, `queue.ts`, `syncLock.ts`, and
 * `authStorage.ts` import unchanged.
 *
 * Unlike the app-store adapter, these helpers keep *structured* values (the
 * token string, account object, mutation queue array, cursors map, client id)
 * rather than JSON strings — matching the original chrome.storage.local
 * semantics, which stored structured-cloneable values directly. IndexedDB does
 * the same, so no (de)serialization is needed.
 *
 * `readJson/writeJson/removeKey` were already async (they wrapped chrome
 * callbacks in promises), so idb-keyval is a near drop-in.
 */

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

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/** Read a structured value from IndexedDB, falling back when unavailable. */
export function readJson<T>(key: CloudSyncStorageKey, fallback: T): Promise<T> {
  if (!isBrowser()) return Promise.resolve(fallback);
  return get<T>(key)
    .then((value) => (value === undefined ? fallback : (value as T)))
    .catch((error) => {
      console.error(`IndexedDB readJson failed for "${key}":`, error);
      return fallback;
    });
}

/** Write a structured value to IndexedDB. */
export function writeJson<T>(
  key: CloudSyncStorageKey,
  value: T
): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  return set(key, value).catch((error) => {
    console.error(`IndexedDB writeJson failed for "${key}":`, error);
  });
}

/** Remove a value from IndexedDB. */
export function removeKey(key: CloudSyncStorageKey): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  return del(key).catch((error) => {
    console.error(`IndexedDB removeKey failed for "${key}":`, error);
  });
}
