/**
 * Tab Session Service
 * Handles saving and restoring Chrome tab sessions
 */

export type { TabSession } from './tabSessionService/sessions';
export {
  STORAGE_KEY,
  CURRENT_SESSION_KEY,
  AUTO_SAVE_INTERVAL,
  isExtensionContext,
  generateSessionId,
  getSavedSessions,
  saveCurrentSession,
  restoreSession,
  deleteSession,
} from './tabSessionService/sessions';
export {
  autoSaveCurrentSession,
  restoreLastSession,
  checkForSessionRestore,
  startAutoSaveMonitoring,
} from './tabSessionService/autoSave';
