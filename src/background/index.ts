/**
 * Phase 5 background service worker.
 *
 * Keeps cloud sync running even when the popup/newtab UI is closed:
 *   - registers a `chrome.alarms` cadence (re-armed on install + startup, which
 *     survive service-worker restarts),
 *   - runs one background sync pass on install, on startup, and on each alarm,
 *   - renews the sync access token before it expires (`token-renewal` alarm at
 *     `exp - 24h`, see `lib/cloudflareSync/tokenRenewal`).
 *
 * It is also the single owner of tab-session auto-save (§4 of
 * fix-cross-context-data-loss): only this worker registers tab listeners and
 * the periodic `current_tab_session` write, and it answers page contexts'
 * `save-tab-session` / `restore-tab-session` messages.
 *
 * The actual sync (push queue + pull + apply to persisted state) lives in
 * `backgroundSyncAll`; this file only wires the Chrome events. It is bundled by
 * esbuild into `build/background.js` (single ESM file, DOM-free).
 */
import {
  backgroundSyncAll,
  backgroundReconcileAll,
  getLastReconciledAt,
} from '@/lib/cloudflareSync/backgroundSync';
import {
  TOKEN_RENEWAL_ALARM,
  ensureTokenRenewal,
  runTokenRenewal,
} from '@/lib/cloudflareSync/tokenRenewal';
import {
  SAVE_TAB_SESSION_MESSAGE_TYPE,
  RESTORE_TAB_SESSION_MESSAGE_TYPE,
  autoSaveCurrentSession,
  checkForSessionRestore,
  isWorkerContext,
  startAutoSaveMonitoring,
  type TabSessionMessageResponse,
} from '@/lib/tabSessionService/autoSave';
import { registerQuickClipMenu, onQuickClipClicked } from './quickClip';

const SYNC_ALARM_NAME = 'cloud-sync';
/** MV3 alarm period, in minutes. Kept conservative to limit Worker load. */
const SYNC_ALARM_PERIOD_MINUTES = 5;

/** Full-snapshot reconciliation cadence, in minutes (D7). */
const RECONCILE_ALARM_NAME = 'cloud-reconcile';
const RECONCILE_ALARM_PERIOD_MINUTES = 30;
const RECONCILE_STALE_MS = RECONCILE_ALARM_PERIOD_MINUTES * 60 * 1000;

function ensureAlarms(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  // `create` with the same name resets the timer; safe to call on every wake.
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_ALARM_PERIOD_MINUTES,
  });
  chrome.alarms.create(RECONCILE_ALARM_NAME, {
    periodInMinutes: RECONCILE_ALARM_PERIOD_MINUTES,
  });
}

async function runSync(reason: string): Promise<void> {
  try {
    const result = await backgroundSyncAll();
    console.debug(
      `[cloud-sync] ${reason}: ${result.projects} project(s), ${result.status}`
    );
  } catch (error) {
    console.error(`[cloud-sync] ${reason} failed`, error);
  }
}

async function runReconcile(reason: string): Promise<void> {
  try {
    const result = await backgroundReconcileAll();
    console.debug(
      `[cloud-reconcile] ${reason}: ${result.projects} project(s), ${result.status}`
    );
  } catch (error) {
    console.error(`[cloud-reconcile] ${reason} failed`, error);
  }
}

/**
 * Online/offline/startup triggers should run reconcile at most once per cadence;
 * skip if the last reconcile finished within the period (D7). The incremental
 * sync alarm runs on its own tight cadence regardless.
 */
async function runReconcileIfStale(reason: string): Promise<void> {
  try {
    const last = await getLastReconciledAt();
    if (last) {
      const elapsed = Date.now() - new Date(last).getTime();
      if (elapsed < RECONCILE_STALE_MS) return;
    }
    await runReconcile(reason);
  } catch (error) {
    console.error(`[cloud-reconcile] ${reason} gate failed`, error);
  }
}

/**
 * Session-restore eligibility lives here (worker-only, §4): pages delegate via
 * `restore-tab-session` instead of running the check per page — N concurrent
 * checks could each observe "no open tabs" and restore duplicate windows.
 */
async function runSessionRestoreCheck(reason: string): Promise<void> {
  try {
    const restored = await checkForSessionRestore();
    console.debug(
      `[tab-session] restore check (${reason}): ${
        restored ? 'restored' : 'not restored'
      }`
    );
  } catch (error) {
    console.error(`[tab-session] restore check (${reason}) failed`, error);
  }
}

/** Tab-session message types this worker answers (see autoSave.ts). */
const TAB_SESSION_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  SAVE_TAB_SESSION_MESSAGE_TYPE,
  RESTORE_TAB_SESSION_MESSAGE_TYPE,
]);

/** Handle one page-delegated tab-session request; the value answers the page. */
async function runTabSessionMessage(
  messageType: string
): Promise<TabSessionMessageResponse> {
  if (messageType === SAVE_TAB_SESSION_MESSAGE_TYPE) {
    await autoSaveCurrentSession();
    return { ok: true };
  }
  const restored = await checkForSessionRestore();
  return { ok: true, restored };
}

// Page contexts (popup/newtab) delegate tab-session writes here so exactly one
// writer exists for `current_tab_session` — the worker. Registered at top level
// (first event-loop turn). Each message gets its own try/catch: unknown
// messages are ignored (no response, channel closed) so other listeners can
// answer them, and a failed save/report never throws back into Chrome.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    const messageType = (message as { type?: unknown } | null | undefined)
      ?.type;
    if (
      typeof messageType !== 'string' ||
      !TAB_SESSION_MESSAGE_TYPES.has(messageType)
    ) {
      return; // Not ours — don't respond, don't hold the channel open.
    }
    if (!isWorkerContext()) return; // Paranoia: pages must not double-handle.

    void runTabSessionMessage(messageType).then(
      (response) => {
        try {
          sendResponse(response);
        } catch (error) {
          console.error('[tab-session] failed to answer message', error);
        }
      },
      (error) => {
        console.error('[tab-session] message handling failed', error);
        try {
          sendResponse({ ok: false });
        } catch (responseError) {
          console.error(
            '[tab-session] failed to report failure',
            responseError
          );
        }
      }
    );
    // Keep the message channel open until the async work answers.
    return true;
  } catch (error) {
    console.error('[tab-session] failed to queue message handling', error);
    return false;
  }
});

// Re-arm on install and on browser startup so the cadence persists across
// restarts, and run an immediate pass to catch up after being closed.
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  registerQuickClipMenu();
  void ensureTokenRenewal();
  void runSync('onInstalled');
  void runReconcile('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  registerQuickClipMenu();
  void ensureTokenRenewal();
  void runSync('onStartup');
  void runReconcile('onStartup');
  void runSessionRestoreCheck('onStartup');
});

// Right-click "Save to TabSpace": clip the page/link into Quick Clips storage
// without opening a tab. Handled entirely in the service worker.
if (typeof chrome !== 'undefined' && chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'save-to-tabspace') {
      void onQuickClipClicked(info, tab);
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === SYNC_ALARM_NAME) {
    void runSync('onAlarm');
  } else if (alarm?.name === RECONCILE_ALARM_NAME) {
    void runReconcile('onAlarm');
  } else if (alarm?.name === TOKEN_RENEWAL_ALARM) {
    void runTokenRenewal('onAlarm');
  }
});

// Offline → online: repair divergences once we're back, gated by staleness so a
// flapping connection doesn't spin up a reconcile per event (D7).
if (
  typeof self !== 'undefined' &&
  typeof self.addEventListener === 'function'
) {
  self.addEventListener('online', () => {
    void runReconcileIfStale('online');
  });
}

// The service worker may be spawned directly by an alarm with no onStartup;
// make sure the alarms are always armed when the worker boots. The token
// freshness check is cheap insurance: MV3 workers are ephemeral, so re-check
// `exp` on every boot (the persisted renewal backoff keeps it from hammering
// the renew endpoint while offline).
ensureAlarms();
registerQuickClipMenu();
void ensureTokenRenewal();

// Tab-session auto-save is worker-owned (§4): this is the single auto-saver.
// Pages delegate their saves via `save-tab-session` messages (handled above);
// the guard inside makes this a no-op if the module ever lands in a page.
void startAutoSaveMonitoring();
