import {
  readJson,
  writeJson,
  removeKey,
  CLOUD_SYNC_STORAGE_KEYS,
  type CloudSyncStorageKey,
} from '@tabspace/shared/lib/cloudflareSync/storage';
import type { CloudAccount } from './types';

/**
 * Auth credentials for the sync client.
 *
 * The access token is the only credential stored in the extension, per the
 * security requirements. It lives in chrome.storage.local (never in any synced
 * browser store). Non-secret account info is stored alongside for quick UI
 * rendering without a network round-trip.
 */

export async function getToken(): Promise<string | null> {
  return readJson<string | null>(CLOUD_SYNC_STORAGE_KEYS.token, null);
}

export async function setToken(token: string): Promise<void> {
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.token, token);
}

export async function getAccount(): Promise<CloudAccount | null> {
  return readJson<CloudAccount | null>(CLOUD_SYNC_STORAGE_KEYS.account, null);
}

export async function setAccount(account: CloudAccount): Promise<void> {
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.account, account);
}

/** Wipe the token and cached account info (e.g. on sign-out). */
export async function clearAuth(): Promise<void> {
  await removeKey(CLOUD_SYNC_STORAGE_KEYS.token);
  await removeKey(CLOUD_SYNC_STORAGE_KEYS.account);
}

// --- Token renewal backoff state (harden-auth-tokens, task 4.2) -------------

/** Persisted retry schedule for the background renewal alarm. */
export interface RenewalRetryState {
  /** Failed renewal attempts so far (drives the backoff step). */
  failures: number;
  /** Epoch ms of the next scheduled renewal attempt. */
  nextAttemptAt: number;
}

/**
 * Backoff state for `tokenRenewal` lives beside the token so a restarted
 * service worker resumes the retry schedule instead of re-hammering the renew
 * endpoint. The key is namespaced like the shared table in storage.ts but
 * declared (and only used) here — the shared table itself is outside this
 * change's file scope.
 */
const RENEWAL_RETRY_KEY = 'cloud-sync-renewal-retry' as CloudSyncStorageKey;

export async function getRenewalRetryState(): Promise<RenewalRetryState | null> {
  return readJson<RenewalRetryState | null>(RENEWAL_RETRY_KEY, null);
}

export async function setRenewalRetryState(
  state: RenewalRetryState
): Promise<void> {
  await writeJson(RENEWAL_RETRY_KEY, state);
}

export async function clearRenewalRetryState(): Promise<void> {
  await removeKey(RENEWAL_RETRY_KEY);
}
