/**
 * Phase 5 background service worker.
 *
 * Keeps cloud sync running even when the popup/newtab UI is closed:
 *   - registers a `chrome.alarms` cadence (re-armed on install + startup, which
 *     survive service-worker restarts),
 *   - runs one background sync pass on install, on startup, and on each alarm.
 *
 * The actual sync (push queue + pull + apply to persisted state) lives in
 * `backgroundSyncAll`; this file only wires the Chrome events. It is bundled by
 * esbuild into `build/background.js` (single ESM file, DOM-free).
 */
import { backgroundSyncAll } from '@/lib/cloudflareSync/backgroundSync';

const ALARM_NAME = 'cloud-sync';
/** MV3 alarm period, in minutes. Kept conservative to limit Worker load. */
const ALARM_PERIOD_MINUTES = 5;

function ensureAlarm(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  // `create` with the same name resets the timer; safe to call on every wake.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
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

// Re-arm on install and on browser startup so the cadence persists across
// restarts, and run an immediate pass to catch up after being closed.
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void runSync('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void runSync('onStartup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === ALARM_NAME) {
    void runSync('onAlarm');
  }
});

// The service worker may be spawned directly by an alarm with no onStartup;
// make sure the alarm is always armed when the worker boots.
ensureAlarm();
