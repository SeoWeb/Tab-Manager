import { readJson, writeJson, CLOUD_SYNC_STORAGE_KEYS } from './storage';

/** Default Worker URL. Empty until the user configures their deployment. */
export const DEFAULT_API_BASE_URL = '';

/** Get the configured Cloudflare Worker base URL. */
export async function getApiBaseUrl(): Promise<string> {
  return readJson<string>(
    CLOUD_SYNC_STORAGE_KEYS.apiBaseUrl,
    DEFAULT_API_BASE_URL
  );
}

/** Persist the Worker base URL. */
export async function setApiBaseUrl(url: string): Promise<void> {
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.apiBaseUrl, url.trim());
}

/**
 * A stable per-installation client id. Used as `clientId` on every mutation so
 * the server (and this client when applying echoed changes) can tell which
 * changes originated here. Generated lazily on first use.
 */
export async function getClientId(): Promise<string> {
  const existing = await readJson<string | null>(
    CLOUD_SYNC_STORAGE_KEYS.clientId,
    null
  );
  if (existing) return existing;

  const generated = `ext-${crypto.randomUUID()}`;
  await writeJson(CLOUD_SYNC_STORAGE_KEYS.clientId, generated);
  return generated;
}
