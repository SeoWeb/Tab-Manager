import { useAppStore } from '@/stores/appStore';
import * as client from '../client';
import * as config from '../config';
import * as authStorage from '../authStorage';
import * as queue from '../queue';
import { isOnline, setCloudState } from './internal';
import type { CloudAccount } from '../types';

/**
 * Load persisted credentials, API URL, and queue length into the store so the UI
 * reflects state across sessions. Resets any transient status (e.g. a `syncing`
 * left over from a previous session that never finished).
 */
export async function initCloudSync(): Promise<void> {
  const [account, apiBaseUrl, queueLength] = await Promise.all([
    authStorage.getAccount(),
    config.getApiBaseUrl(),
    queue.getQueueLength(),
  ]);

  const enabled = !!account && !!apiBaseUrl;

  setCloudState({
    account,
    apiBaseUrl,
    enabled,
    pendingMutationCount: queueLength,
    pendingEdits: queue.pendingEditsFromQueue(await queue.getQueue()),
    status: enabled ? (isOnline() ? 'idle' : 'offline') : 'idle',
    lastError: null,
  });
}

/** Persist the API URL in both the store and chrome.storage.local. */
export async function setCloudApiBaseUrl(url: string): Promise<void> {
  await config.setApiBaseUrl(url);
  const trimmed = url.trim();
  const account = await authStorage.getAccount();
  setCloudState({ apiBaseUrl: trimmed, enabled: !!account && !!trimmed });
}

/**
 * Step 1 of the email sign-in flow. Persists the API URL, then asks the backend
 * to email an 8-digit login code to the address. The backend always responds
 * 202 (even for unknown addresses) to avoid account enumeration, so this never
 * rejects on "no account" — callers simply advance to the code-entry step.
 */
export async function requestLoginCode(input: {
  apiBaseUrl: string;
  email: string;
  displayName?: string;
}): Promise<void> {
  await config.setApiBaseUrl(input.apiBaseUrl);
  await client.requestLoginCode({
    email: input.email,
    displayName: input.displayName,
  });
}

/**
 * Step 2 of the email sign-in flow. Submits the 8-digit code; on success the
 * backend returns a JWT which we persist, and the account becomes "connected".
 */
export async function verifyAndConnect(input: {
  email: string;
  code: string;
}): Promise<CloudAccount> {
  const { token, account } = await client.verifyLoginCode({
    email: input.email,
    code: input.code,
  });

  await authStorage.setToken(token);
  await authStorage.setAccount(account);

  const apiBaseUrl = await config.getApiBaseUrl();

  setCloudState({
    account,
    apiBaseUrl,
    enabled: true,
    status: 'idle',
    lastError: null,
  });

  return account;
}

/** Verify the stored token still works (used by the settings panel). */
export async function verifyCloudAccount(): Promise<CloudAccount | null> {
  try {
    const { user } = await client.getCurrentUser();
    const account: CloudAccount = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    await authStorage.setAccount(account);
    setCloudState({ account, lastError: null });
    return account;
  } catch (error) {
    setCloudState({ lastError: (error as Error).message });
    return null;
  }
}

/** Sign out and clear the local queue (it is meaningless without auth). */
export async function disconnectCloudAccount(): Promise<void> {
  await authStorage.clearAuth();
  await queue.clearQueue();
  // Clear per-project cursors so a different account starts fresh — otherwise
  // the next pull would resume from a stale cursor and miss changes.
  useAppStore.getState().clearProjectCursors();
  setCloudState({
    account: null,
    enabled: false,
    status: 'idle',
    pendingMutationCount: 0,
    pendingEdits: {},
    lastError: null,
    lastSyncedAt: null,
  });
}
