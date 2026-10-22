import {
  readJson,
  writeJson,
  removeKey,
  CLOUD_SYNC_STORAGE_KEYS,
} from '@tabspace/shared/lib/cloudflareSync/storage';

/**
 * Advisory lock (Phase 5) so the background service worker and an open popup
 * don't both run a full sync at once — that could double-apply the same pulled
 * change-log rows.
 *
 * It is **advisory**: chrome.storage has no real compare-and-set, so two
 * contexts racing the read-then-write can in principle both grab it. The server
 * applies mutations idempotently (`clientMutationId`), so the remaining risk is
 * only a transient double-apply of *pulled* rows, which the change-log cursor
 * and the per-change reducer make tolerant in practice. The lock removes the
 * common case (alarm firing while the user clicks "Sync now").
 *
 * The lock is stored under its own chrome.storage.local key as
 * `{ owner, ts }`, where `ts` is epoch milliseconds. A lock held for longer than
 * `LOCK_FRESH_MS` is considered stale (e.g. a context that crashed mid-sync)
 * and can be stolen.
 *
 * Heartbeat (fix-cross-context-data-loss, task 3.3): a legitimate sync can run
 * longer than `LOCK_FRESH_MS` (many queued projects × per-request time). The
 * background path therefore renews the lock while it works via a
 * `chrome.alarms` one-shot (`SYNC_LOCK_HEARTBEAT_ALARM`) that fires every
 * `SYNC_LOCK_HEARTBEAT_INTERVAL_MS`, refreshes `ts`, and re-arms itself. The
 * heartbeat is deliberately an opt-in part of the lock API
 * (`startSyncLockHeartbeat` / `stopSyncLockHeartbeat`) used ONLY by the
 * background path (`backgroundSync.ts`), not started implicitly by
 * `acquireSyncLock`: popup/newtab syncs are short (single project, and every
 * client request is bounded by the 30 s timeout in `client.ts`), and an alarm
 * fired into a closing popup's context would be orphaned. The alarm event
 * dispatches to every extension context, so the listener only refreshes when
 * THIS context actually started the heartbeat (`heartbeatOwner`); other
 * contexts ignore it, and a worker that reboots clears the orphaned alarm
 * (`resetSyncLockHeartbeatForBoot`) so a dead sync's lock simply ages past
 * `LOCK_FRESH_MS` and the existing stale-lock recovery lets the next sync
 * steal it.
 */

export const LOCK_FRESH_MS = 60_000;

/** `chrome.alarms` name for the advisory-lock heartbeat one-shot. */
export const SYNC_LOCK_HEARTBEAT_ALARM = 'cloud-sync-lock-heartbeat';

/**
 * Heartbeat period: comfortably below `LOCK_FRESH_MS` so a single missed beat
 * never lets a live lock be judged stale.
 */
export const SYNC_LOCK_HEARTBEAT_INTERVAL_MS = 30_000;

interface SyncLockRecord {
  owner: string;
  ts: number;
}

function nowMs(): number {
  return Date.now();
}

function isFresh(record: SyncLockRecord | null): boolean {
  if (!record) return false;
  return nowMs() - record.ts < LOCK_FRESH_MS;
}

async function readLock(): Promise<SyncLockRecord | null> {
  return readJson<SyncLockRecord | null>(
    CLOUD_SYNC_STORAGE_KEYS.syncLock,
    null
  );
}

/**
 * Acquire the lock for `owner` unless another owner currently holds a fresh one.
 * Returns true when acquired (or when this owner already held it), false when a
 * different fresh owner holds it.
 */
export async function acquireSyncLock(owner: string): Promise<boolean> {
  const existing = await readLock();
  if (existing && existing.owner !== owner && isFresh(existing)) {
    return false;
  }
  await writeJson<SyncLockRecord>(CLOUD_SYNC_STORAGE_KEYS.syncLock, {
    owner,
    ts: nowMs(),
  });
  return true;
}

/**
 * Release the lock, but only if it still belongs to `owner`. This prevents one
 * context from clearing a lock another context legitimately stole after a
 * timeout.
 */
export async function releaseSyncLock(owner: string): Promise<void> {
  const existing = await readLock();
  if (existing && existing.owner === owner) {
    await removeKey(CLOUD_SYNC_STORAGE_KEYS.syncLock);
  }
}

/** Whether a different, fresh owner currently holds the lock. */
export async function isSyncLockedByOther(owner: string): Promise<boolean> {
  const existing = await readLock();
  return Boolean(existing && existing.owner !== owner && isFresh(existing));
}

// --- Lock heartbeat (background path only) -----------------------------------

/**
 * The context that currently services the heartbeat alarm, or null. This is an
 * in-memory (per-context) claim on purpose: the alarm event dispatches to every
 * extension context, and only the sync that actually acquired the lock may
 * refresh it. A freshly rebooted worker (whose claim died with the previous
 * instance) therefore ignores — and, at boot, clears — a leftover alarm.
 */
let heartbeatOwner: string | null = null;

function alarmsAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.alarms;
}

/** (Re)arm the one-shot heartbeat alarm. */
function armHeartbeatAlarm(): void {
  if (!alarmsAvailable()) return;
  // `create` with the same name resets the timer; a one-shot that the onAlarm
  // listener re-arms after each refresh keeps the effective period at
  // SYNC_LOCK_HEARTBEAT_INTERVAL_MS without depending on periodInMinutes
  // minimums that vary across Chrome versions.
  chrome.alarms.create(SYNC_LOCK_HEARTBEAT_ALARM, {
    when: Date.now() + SYNC_LOCK_HEARTBEAT_INTERVAL_MS,
  });
}

function clearHeartbeatAlarm(): void {
  if (!alarmsAvailable()) return;
  // Support both promise- and callback-shaped typings; never leak the float.
  void Promise.resolve(chrome.alarms.clear(SYNC_LOCK_HEARTBEAT_ALARM)).catch(
    () => undefined
  );
}

/**
 * Start the heartbeat for `owner` after that owner acquired the lock. Returns
 * true when a heartbeat alarm could be armed (chrome.alarms available); the
 * lock itself is unaffected either way.
 */
export async function startSyncLockHeartbeat(owner: string): Promise<boolean> {
  heartbeatOwner = owner;
  if (!alarmsAvailable()) return false;
  armHeartbeatAlarm();
  return true;
}

/**
 * Stop the heartbeat: drop this context's claim and clear the alarm. Called on
 * release (the `finally` of the background sync path) and whenever a refresh
 * finds the lock gone, stolen, or stale.
 */
export async function stopSyncLockHeartbeat(): Promise<void> {
  heartbeatOwner = null;
  clearHeartbeatAlarm();
}

/**
 * One heartbeat tick: re-validate the lock, refresh `ts` so it stays fresh for
 * another `LOCK_FRESH_MS`, and re-arm. If the lock was released, stolen, or
 * already went stale (a lapsed heartbeat), stop instead — a dead sync must not
 * pin the lock fresh forever.
 */
async function refreshSyncLockHeartbeat(): Promise<void> {
  const owner = heartbeatOwner;
  if (owner === null) return;
  const existing = await readLock();
  if (!existing || existing.owner !== owner || !isFresh(existing)) {
    await stopSyncLockHeartbeat();
    return;
  }
  await writeJson<SyncLockRecord>(CLOUD_SYNC_STORAGE_KEYS.syncLock, {
    owner,
    ts: nowMs(),
  });
  armHeartbeatAlarm();
}

/**
 * Worker-boot recovery: drop any heartbeat left over from a previous worker
 * instance. The previous instance's in-memory claim died with it, so its armed
 * alarm would fire forever with nobody legitimately servicing it (waking the
 * worker every 30 s); the abandoned lock record itself simply ages past
 * `LOCK_FRESH_MS` and the existing stale-lock recovery in `acquireSyncLock`
 * lets the next sync take over. Invoked at module load in the service worker
 * (the popup path never claims the heartbeat, so pages must not clear what a
 * live worker may still be servicing).
 */
export function resetSyncLockHeartbeatForBoot(): void {
  heartbeatOwner = null;
  clearHeartbeatAlarm();
}

// The service worker imports this module at boot (via `backgroundSync`), so a
// top-level cleanup is the "clear on worker boot" half of the heartbeat
// lifecycle. Extension pages have a `document`; the MV3 service worker does
// not. (chrome.alarms is additionally unavailable in tests without a mock.)
if (
  typeof document === 'undefined' &&
  typeof chrome !== 'undefined' &&
  chrome.alarms
) {
  resetSyncLockHeartbeatForBoot();
}

// Registered at module load so the listener exists during the worker's first
// event-loop turn (required for alarm-woken events to be delivered).
if (
  typeof chrome !== 'undefined' &&
  chrome.alarms &&
  chrome.alarms.onAlarm &&
  chrome.alarms.onAlarm.addListener
) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SYNC_LOCK_HEARTBEAT_ALARM) return;
    // Only the context that started the heartbeat may service it: another
    // context's claim is not visible here, and refreshing a lock this context
    // does not own would be wrong. Orphaned alarms are handled by the boot
    // cleanup above, not by bystander contexts.
    if (heartbeatOwner === null) return;
    void refreshSyncLockHeartbeat();
  });
}
