/**
 * Web stub for the Chrome tab-session save/restore service.
 *
 * Same exported names/signatures as the extension's
 * `src/lib/tabSessionService.ts` so importers resolve unchanged. Chrome tab
 * sessions have no web equivalent, so every function is a no-op.
 *
 * The Tab Sessions panel that consumes this is itself shadowed to a
 * "Not available in web version" message, and the web AppClient never calls
 * `checkForSessionRestore` / `startAutoSaveMonitoring`, so these are
 * unreachable at runtime.
 */
import type { ChromeWindowInfo } from '@/types';

export interface TabSession {
  id: string;
  name: string;
  timestamp: number;
  windows: ChromeWindowInfo[];
  totalTabs: number;
}

export const getSavedSessions = async (): Promise<TabSession[]> => [];

export const saveCurrentSession = async (
  _name?: string
): Promise<TabSession | null> => null;

export const restoreSession = async (_sessionId: string): Promise<boolean> =>
  false;

export const deleteSession = async (_sessionId: string): Promise<boolean> =>
  false;

export const autoSaveCurrentSession = async (): Promise<void> => {};

export const restoreLastSession = async (): Promise<boolean> => false;

export const startAutoSaveMonitoring = (): (() => void) => () => {};

export const checkForSessionRestore = async (): Promise<boolean> => false;
