import type { StateStorage } from 'zustand/middleware';
import { chromeStorageApi } from '@tabspace/shared/stores/storage';

// When `partialize` fails, appStore returns `null` instead of `{}`. Zustand's
// `createJSONStorage` then hands the storage adapter exactly this string:
// `JSON.stringify({ state: <partialize result>, version: <options.version> })`
// (zustand 4.5.7 serializes `{state, version}` in that key order, and the
// store's persist version is 1). The safe adapter below recognizes it and
// skips the write, so a failing partialize can never overwrite the stored
// snapshot with an empty one.
export const PERSIST_SKIPPED_SENTINEL = JSON.stringify({
  state: null,
  version: 1,
});

// Minimal in-module metric: there is no metrics infra in this repo, so a
// counter plus the console.error below IS the metric for now.
let persistSkipCount = 0;

export function recordPersistSkip(): void {
  persistSkipCount += 1;
}

export function getPersistSkipCount(): number {
  return persistSkipCount;
}

export function resetPersistSkipCountForTests(): void {
  persistSkipCount = 0;
}

// Wraps `chromeStorageApi`, intercepting only the skip sentinel. Everything
// else is delegated unchanged.
export const persistSafeStorageAdapter: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return await chromeStorageApi.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (value === PERSIST_SKIPPED_SENTINEL) {
      recordPersistSkip();
      console.error(
        'Persist skipped: partialize failed; stored data left intact'
      );
      return;
    }
    await chromeStorageApi.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await chromeStorageApi.removeItem(name);
  },
};
