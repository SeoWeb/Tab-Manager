/**
 * Client request timeout (fix-cross-context-data-loss, tasks 3.2 / 3.4).
 *
 * Every API request is bounded by a 30 s AbortController: a hung request must
 * settle with a RETRYABLE transport error instead of stranding the advisory
 * sync lock forever. The timeout composes with the single-flight
 * 401→renew→retry-once flow: each attempt gets its own fresh window, and a
 * timeout is never misclassified as a hard 401/auth failure (no renewal, no
 * re-auth signal). The realtime ticket fetch goes through the same
 * `request()` and inherits the timeout.
 */
import {
  listProjects,
  requestRealtimeTicket,
  CloudSyncApiError,
  REQUEST_TIMEOUT_MS,
} from '../client';
import { onAuthExpired, resetTokenRenewalStateForTests } from '../tokenRenewal';

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function jsonError(status: number, message: string): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify({ error: { message } })),
  } as Response;
}

const RENEW_OK = {
  token: 'jwt-rotated',
  user: { id: 'u1', email: 'alice@example.com', display_name: 'Alice' },
};

function installChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const backing: Record<string, unknown> = {
            'cloud-sync-api-base-url': 'http://localhost:8787',
            'cloud-sync-token': 'jwt-current',
          };
          const picked: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (k in backing) picked[k] = backing[k];
          }
          cb(picked);
        },
        set: (_obj: Record<string, unknown>, cb: () => void) => cb(),
        remove: (_keys: string | string[], cb: () => void) => cb(),
      },
    },
  };
}

/** A fetch that never answers; captures its AbortSignal and honours it. */
function hangingFetch(signalOut: { signal: AbortSignal | null }): jest.Mock {
  return jest.fn((_url: string, init?: RequestInit) => {
    const signal = (init?.signal as AbortSignal | null) ?? null;
    signalOut.signal = signal;
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort);
    });
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Drain microtasks until `predicate` holds (bounded) — the request performs a
 * couple of awaited storage reads before fetch fires.
 */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i += 1) {
    await Promise.resolve();
  }
  await flushMicrotasks();
}

describe('client request timeout', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const captured: { signal: AbortSignal | null } = { signal: null };

  beforeEach(() => {
    resetTokenRenewalStateForTests();
    installChrome();
    captured.signal = null;
  });

  afterEach(() => {
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('aborts a hung request at 30 s and surfaces a retryable error (no HTTP status, no renewal)', async () => {
    jest.useFakeTimers();
    fetchMock = hangingFetch(captured);
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = listProjects();
    // The rejection lands while the timers below advance, before the
    // assertion attaches — mark it handled so jest sees no unhandled
    // rejection.
    pending.catch(() => undefined);
    await flushUntil(() => fetchMock.mock.calls.length > 0);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(pending).rejects.toBeInstanceOf(CloudSyncApiError);
    await expect(pending).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('timed out'),
    });
    expect(captured.signal?.aborted).toBe(true);
    // A transport timeout is not an auth problem: no renewal attempted.
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/auth/renew')
      )
    ).toHaveLength(0);
    jest.useRealTimers();
  });

  it('also covers a stalled response body after the headers arrived', async () => {
    jest.useFakeTimers();
    fetchMock = jest.fn((_url: string, init?: RequestInit) => {
      const signal = (init?.signal as AbortSignal | null) ?? null;
      captured.signal = signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const onAbort = () => {
              const error = new Error('The operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            };
            if (signal?.aborted) onAbort();
            else signal?.addEventListener('abort', onAbort);
          }),
      } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = listProjects();
    pending.catch(() => undefined);
    await flushUntil(() => fetchMock.mock.calls.length > 0);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(pending).rejects.toMatchObject({
      name: 'CloudSyncApiError',
      status: 0,
    });
    expect(captured.signal?.aborted).toBe(true);
    jest.useRealTimers();
  });

  it('does not abort a response that completes within the window', async () => {
    jest.useFakeTimers();
    fetchMock = jest.fn(async () => jsonOk({ projects: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = listProjects();
    pending.catch(() => undefined);
    await flushUntil(() => fetchMock.mock.calls.length > 0);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);

    await expect(pending).resolves.toEqual({ projects: [] });
    expect(captured.signal?.aborted).toBeFalsy();
    jest.useRealTimers();
  });

  it('gives the post-renewal retry its own fresh window and never calls a timeout a 401', async () => {
    jest.useFakeTimers();
    let retried = false;
    fetchMock = jest.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/renew')) {
        return Promise.resolve(jsonOk(RENEW_OK));
      }
      if (String(url).endsWith('/projects')) {
        if (!retried) {
          // First attempt: instantly stale token → renewal → retry.
          retried = true;
          return Promise.resolve(jsonError(401, 'Token expired'));
        }
        // The retried attempt hangs; only the timeout can end it.
        const signal = (init?.signal as AbortSignal | null) ?? null;
        captured.signal = signal;
        return new Promise<Response>((_resolve, reject) => {
          const onAbort = () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort);
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    const pending = listProjects();
    pending.catch(() => undefined);
    // Wait until the RETRIED attempt is in flight (it is the only one that
    // captures a signal here), so the 30 s advance below measures the retry's
    // own fresh window.
    await flushUntil(() => captured.signal !== null);

    // Aborting exactly now (30 s after the retry began) proves the first
    // attempt's wait was not charged to the retry.
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(pending).rejects.toMatchObject({
      name: 'CloudSyncApiError',
      status: 0, // NOT 401 — no second renewal, no re-auth signal
    });
    const projectCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/projects')
    );
    const renewCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/renew')
    );
    expect(projectCalls).toHaveLength(2); // 401 + retried attempt
    expect(renewCalls).toHaveLength(1); // exactly one renewal
    expect(onExpired).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('bounds the realtime ticket fetch the same way', async () => {
    jest.useFakeTimers();
    fetchMock = hangingFetch(captured);
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = requestRealtimeTicket('p1');
    pending.catch(() => undefined);
    await flushUntil(() => fetchMock.mock.calls.length > 0);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/realtime/ticket')
      )
    ).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(pending).rejects.toMatchObject({
      name: 'CloudSyncApiError',
      status: 0,
    });
    jest.useRealTimers();
  });
});
