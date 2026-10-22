import { get, set, del } from 'idb-keyval';

// Low-level helpers for persisting sync-client values.
//
// Everything the sync client persists (token, account, queue, cursors, client
// id, api base url) lives in its own storage key, separate from the
// Zustand-persisted store.
//
// Context seams (one module, two backends):
//  - Extension contexts keep the original chrome.storage.local semantics:
//    structured-cloneable values are stored as-is rather than stringifying.
//  - The plain web build (frontend/) has no `chrome` global; it previously
//    shipped its own IndexedDB-backed copy of this module (idb-keyval stores
//    structured values too, so no (de)serialization is needed) and scoped the
//    client id to the session (see below). Both behaviors are preserved here.
//  - SSR / static pre-render has neither backend: read/write/remove degrade to
//    logged no-ops returning the fallback.

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

/** True in a plain-browser context where IndexedDB is usable (not SSR). */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/**
 * The client id is deliberately session-scoped (per tab) in the plain-web
 * context.
 *
 * `client_id` is only used to skip our own sync echoes. If every tab in a
 * browser shared one client id (the extension's behaviour — one install-wide
 * id in chrome.storage.local), a change created in Tab A would be skipped as
 * an "echo" by Tab B — even though Tab B never held it locally — permanently
 * diverging the two tabs. Giving each tab its own client id means Tab B
 * applies Tab A's changes (and vice versa), so multiple tabs stay consistent.
 * Different computers already differed by install, so this also keeps
 * cross-device sync correct. Session storage is per-tab and survives that
 * tab's reloads, but is not shared between tabs.
 *
 * The extension keeps the install-wide stored key: chrome.storage.local is
 * shared across the popup / newtab / service worker, which is exactly the
 * "one sync owner per install" model the extension wants.
 */
const CLIENT_ID_SESSION_KEY = CLOUD_SYNC_STORAGE_KEYS.clientId;

function readClientId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  const value = sessionStorage.getItem(CLIENT_ID_SESSION_KEY);
  return value === null ? null : value;
}

function writeClientId(value: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(CLIENT_ID_SESSION_KEY, value);
}

function deleteClientId(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(CLIENT_ID_SESSION_KEY);
}

/** Read a structured value, falling back when unavailable. */
export function readJson<T>(key: CloudSyncStorageKey, fallback: T): Promise<T> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        const value = result[key];
        resolve(value === undefined ? fallback : (value as T));
      });
    });
  }
  // Plain-web seam: the client id lives in per-tab sessionStorage (above).
  if (key === CLOUD_SYNC_STORAGE_KEYS.clientId) {
    const sessionValue = readClientId();
    return Promise.resolve(
      sessionValue === null ? fallback : (sessionValue as T)
    );
  }
  if (!isBrowser()) return Promise.resolve(fallback);
  return get<T>(key)
    .then((value) => (value === undefined ? fallback : (value as T)))
    .catch((error) => {
      console.error(`IndexedDB readJson failed for "${key}":`, error);
      return fallback;
    });
}

/** Write a structured value. */
export function writeJson<T>(
  key: CloudSyncStorageKey,
  value: T
): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }
  if (key === CLOUD_SYNC_STORAGE_KEYS.clientId) {
    writeClientId(String(value));
    return Promise.resolve();
  }
  if (!isBrowser()) return Promise.resolve();
  return set(key, value).catch((error) => {
    console.error(`IndexedDB writeJson failed for "${key}":`, error);
  });
}

/** Remove a structured value. */
export function removeKey(key: CloudSyncStorageKey): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => resolve());
    });
  }
  if (key === CLOUD_SYNC_STORAGE_KEYS.clientId) {
    deleteClientId();
    return Promise.resolve();
  }
  if (!isBrowser()) return Promise.resolve();
  return del(key).catch((error) => {
    console.error(`IndexedDB removeKey failed for "${key}":`, error);
  });
}
