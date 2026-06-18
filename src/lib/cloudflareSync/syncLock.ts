import {
  readJson,
  writeJson,
  removeKey,
  CLOUD_SYNC_STORAGE_KEYS,
} from './storage';

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
 */

export const LOCK_FRESH_MS = 60_000;

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
