import { StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';

/**
 * Web replacement for the extension's `chrome.storage.local` Zustand adapter.
 *
 * Same export name (`chromeStorageApi`) and same `StateStorage` contract, so
 * `appStore.ts` is imported unchanged — but persistence is backed by
 * IndexedDB via idb-keyval instead of chrome.storage.local. This avoids the
 * ~5 MB `localStorage` ceiling that the persisted projects/collections/links
 * graph can outgrow.
 *
 * Zustand's `createJSONStorage` already serializes state to a JSON string
 * before calling `setItem`, so we store/return the string verbatim (no extra
 * stringify here). The cloud-sync storage adapter below is different: it keeps
 * structured values, not strings.
 *
 * SSR safety: `output: 'export'` pre-renders the page on the server, where
 * `indexedDB` is undefined and idb-keyval would throw. Guard every call so the
 * store simply reports "nothing persisted" during SSG, exactly as the extension
 * adapter does when `chrome` is absent.
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

export const chromeStorageApi: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!isBrowser()) return null;
    try {
      const value = await get<string>(name);
      return value ?? null;
    } catch (error) {
      // Surface quota / IDB failures instead of swallowing silently.
      console.error(
        'IndexedDB getItem failed; state will not be loaded:',
        error
      );
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isBrowser()) return;
    try {
      await set(name, value);
    } catch (error) {
      console.error(
        'IndexedDB setItem failed; state will not be persisted:',
        error
      );
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isBrowser()) return;
    try {
      await del(name);
    } catch (error) {
      console.error('IndexedDB removeItem failed:', error);
    }
  },
};
