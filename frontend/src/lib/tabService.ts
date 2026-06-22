/**
 * Web stub for the Chrome Tabs API service.
 *
 * Same exported names/signatures as the extension's `src/lib/tabService.ts` so
 * every importer resolves unchanged. The Chrome tabs/windows APIs have no web
 * equivalent, so every function is a no-op that returns the "empty" result the
 * extension already returns when `chrome.tabs` is unavailable.
 *
 * The panels that consume this (Chrome Tabs) are themselves shadowed to a
 * "Not available in web version" message, so these are effectively unreachable
 * at runtime — they exist purely to keep the import graph valid.
 */
import type { ChromeTabInfo, ChromeWindowInfo } from '@/types';

export const getAllWindows = async (): Promise<ChromeWindowInfo[]> => [];

export const getWindowTabs = async (
  _windowId: number
): Promise<ChromeTabInfo[]> => [];

export const getAllTabs = async (): Promise<ChromeTabInfo[]> => [];

export const createTab = async (
  _url: string,
  _windowId?: number
): Promise<ChromeTabInfo | null> => null;

export const closeTab = async (_tabId: number): Promise<boolean> => false;

export const moveTabToWindow = async (
  _tabId: number,
  _windowId: number
): Promise<boolean> => false;

export const createWindow = async (
  _urls: string[]
): Promise<ChromeWindowInfo | null> => null;

export const focusWindow = async (_windowId: number): Promise<boolean> => false;

export const switchToTab = async (_tabId: number): Promise<boolean> => false;

export const findTabByUrl = async (
  _url: string
): Promise<ChromeTabInfo | null> => null;

export const setupTabMonitoring = (
  _onTabCreated: (tab: ChromeTabInfo) => void,
  _onTabRemoved: (tabId: number, windowId: number) => void,
  _onTabUpdated: (tabId: number, tab: ChromeTabInfo) => void
): (() => void) => {
  // No chrome.tabs events in a regular browser tab.
  return () => {};
};

export const checkTabsPermission = async (): Promise<boolean> => false;
