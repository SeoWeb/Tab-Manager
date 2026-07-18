import type { CloudSyncState } from '../types';

/** Zustand persist stores the partialized state as `{ state, version }`. */
export const STORE_KEY = 'tab-manager-storage';

export interface PartialState {
  projects?: unknown[];
  notes?: unknown[];
  todos?: unknown[];
  tasks?: unknown[];
  cloudSync?: Partial<CloudSyncState>;
}

export interface PersistedWrapper {
  state?: PartialState;
  version?: number;
}

export function isChromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local
  );
}

export function readStoreRaw(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve(null);
    chrome.storage.local.get([STORE_KEY], (result) => {
      const value = result?.[STORE_KEY];
      resolve(typeof value === 'string' ? value : null);
    });
  });
}

export function writeStoreRaw(value: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isChromeStorageAvailable()) return resolve();
    chrome.storage.local.set({ [STORE_KEY]: value }, () => resolve());
  });
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function readPersistedState(): Promise<PersistedWrapper | null> {
  const raw = await readStoreRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedWrapper;
    // Tolerate a legacy flat shape (state stored without the wrapper).
    if (parsed && parsed.state) return parsed;
    if (parsed && typeof parsed === 'object' && 'projects' in parsed) {
      return { state: parsed as PartialState };
    }
    return null;
  } catch {
    return null;
  }
}
