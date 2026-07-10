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
import {
  backgroundSyncAll,
  backgroundReconcileAll,
  getLastReconciledAt,
} from '@/lib/cloudflareSync/backgroundSync';

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

// Re-arm on install and on browser startup so the cadence persists across
// restarts, and run an immediate pass to catch up after being closed.
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  void runSync('onInstalled');
  void runReconcile('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  void runSync('onStartup');
  void runReconcile('onStartup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === SYNC_ALARM_NAME) {
    void runSync('onAlarm');
  } else if (alarm?.name === RECONCILE_ALARM_NAME) {
    void runReconcile('onAlarm');
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
// make sure the alarms are always armed when the worker boots.
ensureAlarms();
