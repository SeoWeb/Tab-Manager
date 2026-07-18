/**
 * Chrome Tabs API Service
 * Provides utilities for interacting with Chrome's tabs API
 */

export {
  isExtensionContext,
  mapTabToChromeTabInfo,
  mapWindow,
} from './tabService/context';
export {
  getAllWindows,
  getWindowTabs,
  getAllTabs,
  findTabByUrl,
} from './tabService/queries';
export {
  createTab,
  closeTab,
  moveTabToWindow,
} from './tabService/tabMutations';
export { createWindow, focusWindow, switchToTab } from './tabService/windows';
export {
  setupTabMonitoring,
  checkTabsPermission,
} from './tabService/monitoring';
