import { getApiBaseUrl } from './config';
import {
  getToken,
  setToken,
  setAccount,
  getRenewalRetryState,
  setRenewalRetryState,
  clearRenewalRetryState,
} from './authStorage';
import type { CloudAccount, CloudVerifyResponse } from './types';

/**
 * Background token renewal (harden-auth-tokens, tasks 4.2 + 4.3).
 *
 * Access tokens carry a bounded `exp` (JWT, unix seconds). This module:
 *   - parses `exp` from the stored token (base64url payload decode; the client
 *     does NOT verify the signature — that is the server's job),
 *   - schedules a `chrome.alarms` one-shot at `exp - 24h` to renew silently
 *     via `POST /auth/renew` (recomputing the alarm after every success),
 *   - retries failed renewals with exponential backoff (15 min → 1 h → 6 h,
 *     capped at 24 h) that persists across service-worker restarts,
 *   - fires the re-auth signal EXACTLY ONCE per token on a hard 401 (renewal
 *     rejected → the session is unrecoverable and the user must sign in
 *     again), so parallel request failures cannot spam the prompt.
 *
 * Renewal is single-flight: concurrent 401s across the HTTP client share one
 * in-flight renewal promise.
 *
 * The auth-expiry signal is a plain listener (`onAuthExpired`) rather than a
 * direct store write because this module also runs in the DOM-free service
 * worker, which must not import the React app store. UI surfaces subscribe in
 * the popup context; the SW just logs.
 */

/** `chrome.alarms` name for the pre-expiry renewal one-shot. */
export const TOKEN_RENEWAL_ALARM = 'token-renewal';

/** Renew this long before `exp` (harden-auth-tokens: T-24h window). */
export const RENEWAL_WINDOW_SECONDS = 24 * 60 * 60;

/** Backoff steps for transient renewal failures (15 min → 1 h → 6 h). */
const BACKOFF_STEPS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
/** Hard cap on the retry delay. */
const BACKOFF_CAP_MS = 24 * 60 * 60_000;

/** Shown (once) by the UI when the session is unrecoverably expired. */
export const AUTH_EXPIRED_MESSAGE =
  'Your cloud sync session has expired. Please sign in again.';

/** Outcome of one renewal attempt. */
export type RenewOutcome =
  /** Fresh token obtained and persisted. */
  | 'renewed'
  /** Server answered 401: the current token is invalid/expired beyond renewal. */
  | 'unauthorized'
  /** Network error, 5xx, rate limit (429), or malformed success body — retryable. */
  | 'transient'
  /** No stored token: nothing to renew (the user is signed out). */
  | 'not-signed-in';

// --- Auth-expiry signal (single prompt per token) ---------------------------

type AuthExpiredListener = (message: string) => void;

let authExpiredListener: AuthExpiredListener | null = null;
/**
 * The token for which the expiry signal last fired. Keying the dedupe on the
 * token (rather than a bare flag) means a NEW token — from a successful
 * renewal or a fresh sign-in — can raise the signal again if it later hard
 * expires, while repeated failures against the SAME token fire only once.
 */
let authExpiredReportedForToken: string | null = null;

/**
 * Register the re-auth signal handler (popup context; the UI shows the single
 * sign-in prompt). Returns an unsubscribe function. Fires at most once per
 * expired token, no matter how many requests fail.
 */
export function onAuthExpired(listener: AuthExpiredListener): () => void {
  authExpiredListener = listener;
  return () => {
    if (authExpiredListener === listener) authExpiredListener = null;
  };
}

function reportAuthExpired(token: string): void {
  if (authExpiredReportedForToken === token) return;
  authExpiredReportedForToken = token;
  try {
    authExpiredListener?.(AUTH_EXPIRED_MESSAGE);
  } catch {
    // A faulty UI listener must never break the sync/renewal flow.
  }
}

// --- Shared /auth/verify + /auth/renew response parsing ---------------------

/**
 * Parse the JSON both `POST /auth/verify` and `POST /auth/renew` return (the
 * renew endpoint reuses the verify response shape verbatim): the new JWT plus
 * the resolved user. Shared with `client.verifyLoginCode` so the two callers
 * can never drift.
 */
export function parseAuthResponse(result: CloudVerifyResponse): {
  token: string;
  account: CloudAccount;
} {
  return {
    token: result.token,
    account: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.display_name ?? null,
    },
  };
}

function isAuthResponseShape(value: unknown): value is CloudVerifyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as {
    token?: unknown;
    user?: { id?: unknown; email?: unknown; display_name?: unknown };
  };
  return (
    typeof body.token === 'string' &&
    body.token.length > 0 &&
    typeof body.user === 'object' &&
    body.user !== null &&
    typeof body.user.id === 'string' &&
    typeof body.user.email === 'string'
  );
}

// --- JWT exp parsing (client-side decode; no signature verification) --------

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  // JWT payloads are UTF-8 JSON; atob alone would mangle non-ASCII characters.
  try {
    return new TextDecoder().decode(
      Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    );
  } catch {
    return binary;
  }
}

/**
 * Extract the `exp` claim (unix seconds) from a JWT without verifying it.
 * Returns null for legacy exp-less tokens or unparseable input — callers
 * treat that as "cannot schedule", not as "invalid".
 */
export function getTokenExpirySeconds(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as {
      exp?: unknown;
    };
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp;
    }
    return null;
  } catch {
    return null;
  }
}

// --- Single-flight renewal ---------------------------------------------------

let inflightRenewal: Promise<RenewOutcome> | null = null;

/**
 * Renew the access token once via `POST /auth/renew` (Bearer: current token,
 * no body). Concurrent callers share one in-flight promise, so N parallel 401s
 * produce exactly one renew call. On success the new token (and refreshed
 * account) are persisted and the renewal alarm is recomputed from the new
 * `exp`. On a hard 401 the once-only re-auth signal fires.
 */
export function renewTokenOnce(): Promise<RenewOutcome> {
  if (inflightRenewal) return inflightRenewal;
  inflightRenewal = doRenewToken().finally(() => {
    inflightRenewal = null;
  });
  return inflightRenewal;
}

/** Boolean convenience for the HTTP client's 401 retry path. */
export async function renewToken(): Promise<boolean> {
  return (await renewTokenOnce()) === 'renewed';
}

async function doRenewToken(): Promise<RenewOutcome> {
  const token = await getToken();
  if (!token) return 'not-signed-in';

  const baseUrl = (await getApiBaseUrl()).replace(/\/+$/, '');
  if (!baseUrl) return 'transient';

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/renew`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return 'transient';
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Hard expiry: the current token is beyond renewal. Surface the single
      // re-auth prompt; callers stop retrying.
      reportAuthExpired(token);
      return 'unauthorized';
    }
    // 429 (rate limit) / 5xx / anything else transient.
    return 'transient';
  }

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!isAuthResponseShape(body)) return 'transient';

  const { token: newToken, account } = parseAuthResponse(body);
  await setToken(newToken);
  await setAccount(account);
  await clearRenewalRetryState();
  // Recompute the alarm from the fresh token's expiry.
  await scheduleTokenRenewalAlarm();
  return 'renewed';
}

// --- Alarm scheduling ---------------------------------------------------------

function alarmsAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.alarms;
}

function createRenewalAlarm(whenMs: number): void {
  if (!alarmsAvailable()) return;
  // `create` with the same name resets the timer; safe to re-arm on every boot.
  chrome.alarms.create(TOKEN_RENEWAL_ALARM, { when: whenMs });
}

function clearRenewalAlarm(): void {
  if (!alarmsAvailable()) return;
  // Support both promise- and callback-shaped typings; never leak the float.
  void Promise.resolve(chrome.alarms.clear(TOKEN_RENEWAL_ALARM)).catch(
    () => undefined
  );
}

/** Delay before the nth retry (1-based): 15 min, 1 h, 6 h, then 24 h cap. */
function renewalBackoffDelayMs(failures: number): number {
  const step = failures - 1;
  if (step < BACKOFF_STEPS_MS.length) return BACKOFF_STEPS_MS[step];
  return BACKOFF_CAP_MS;
}

/**
 * (Re)arm the renewal alarm at `exp - 24h` for the CURRENT stored token.
 * Called after every successful renewal and whenever a token is replaced.
 * Legacy tokens without `exp` cannot be anchored to a time and are skipped.
 */
export async function scheduleTokenRenewalAlarm(): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const exp = getTokenExpirySeconds(token);
  if (exp === null) return;
  const fireAtMs = (exp - RENEWAL_WINDOW_SECONDS) * 1000;
  createRenewalAlarm(Math.max(fireAtMs, 0));
}

/**
 * One renewal pass driven by the alarm / startup check: renew, and on a
 * transient failure schedule the next attempt with exponential backoff
 * (persisted so a restarted service worker resumes the schedule instead of
 * hammering the endpoint). On a hard 401 the retry state is dropped and the
 * alarm cleared — only re-authentication can recover from there.
 */
export async function runTokenRenewal(reason: string): Promise<RenewOutcome> {
  const outcome = await renewTokenOnce();
  if (outcome === 'renewed') return outcome; // alarm + retry state handled in doRenewToken

  if (outcome === 'unauthorized' || outcome === 'not-signed-in') {
    // Unrecoverable without user action (or nothing to renew): stop the
    // retry loop. The expiry signal, if applicable, already fired once.
    await clearRenewalRetryState();
    clearRenewalAlarm();
    console.debug(`[token-renewal] stopping (${reason}): ${outcome}`);
    return outcome;
  }

  // Transient: escalate the backoff and re-arm the alarm for the next try.
  const previous = await getRenewalRetryState();
  const failures = (previous?.failures ?? 0) + 1;
  const delayMs = renewalBackoffDelayMs(failures);
  const nextAttemptAt = Date.now() + delayMs;
  await setRenewalRetryState({ failures, nextAttemptAt });
  createRenewalAlarm(nextAttemptAt);
  console.debug(
    `[token-renewal] ${reason}: renew failed transiently; retry in ${Math.round(delayMs / 60000)}m`
  );
  return outcome;
}

/**
 * Service-worker startup / onInstalled check (cheap insurance — alarms survive
 * restarts but the worker is ephemeral). Outside the renewal window this just
 * (re)arms the alarm; inside it — or for a legacy exp-less token — it renews
 * now, gated by the persisted backoff so repeated boots cannot hammer the
 * endpoint while offline.
 */
export async function ensureTokenRenewal(): Promise<void> {
  const token = await getToken();
  if (!token) return;

  const exp = getTokenExpirySeconds(token);
  if (exp !== null) {
    const fireAtMs = (exp - RENEWAL_WINDOW_SECONDS) * 1000;
    if (fireAtMs > Date.now()) {
      createRenewalAlarm(fireAtMs);
      return;
    }
  }

  // Inside the renewal window (or legacy token without exp — rotate it too).
  const state = await getRenewalRetryState();
  if (state && state.nextAttemptAt > Date.now()) {
    // A failed attempt is already scheduled; keep that cadence.
    createRenewalAlarm(state.nextAttemptAt);
    return;
  }
  await runTokenRenewal('startup');
}

/** Reset module state (jest). */
export function resetTokenRenewalStateForTests(): void {
  inflightRenewal = null;
  authExpiredListener = null;
  authExpiredReportedForToken = null;
}
