import { StateStorage } from 'zustand/middleware';

// Custom storage adapter for chrome.storage.local
export const chromeStorageApi: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.get([name], (result) => {
          resolve(result[name] || null);
        });
      } else {
        // Chrome storage API is not available (e.g., during SSR or in a non-extension environment)
        console.warn(
          'chrome.storage.local is not available. Persisted state will not be loaded.'
        );
        resolve(null);
      }
    });
  },
  setItem: async (name: string, value: string): Promise<void> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.set({ [name]: value }, () => {
          resolve();
        });
      } else {
        console.warn(
          'chrome.storage.local is not available. State will not be persisted.'
        );
        resolve();
      }
    });
  },
  removeItem: async (name: string): Promise<void> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.remove([name], () => {
          resolve();
        });
      } else {
        console.warn(
          'chrome.storage.local is not available. Item will not be removed from persisted state.'
        );
        resolve();
      }
    });
  },
};
