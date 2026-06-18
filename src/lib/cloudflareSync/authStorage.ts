import {
  readJson,
  writeJson,
  removeKey,
  CLOUD_SYNC_STORAGE_KEYS,
} from './storage';
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
