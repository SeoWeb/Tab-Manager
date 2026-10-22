import {
  getTokenExpirySeconds,
  ensureTokenRenewal,
  runTokenRenewal,
  renewToken,
  renewTokenOnce,
  onAuthExpired,
  resetTokenRenewalStateForTests,
  TOKEN_RENEWAL_ALARM,
  RENEWAL_WINDOW_SECONDS,
  AUTH_EXPIRED_MESSAGE,
} from '../tokenRenewal';
import { getRenewalRetryState } from '../authStorage';

/**
 * Background renewal (harden-auth-tokens, task 4.2):
 *   - alarm fires at `exp - 24h` (or immediately when already inside the
 *     window),
 *   - transient failures retry with persisted exponential backoff
 *     (15 min → 1 h → 6 h, cap 24 h),
 *   - a hard 401 raises the re-auth signal EXACTLY ONCE per token,
 *   - renewal is single-flight.
 */

const DAY_S = 24 * 60 * 60;

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(exp: number | null): string {
  const payload = exp === null ? {} : { exp };
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

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

/** In-memory chrome.storage.local + chrome.alarms. */
function installChrome(initial: Record<string, unknown> = {}): {
  store: Record<string, unknown>;
  alarmCreates: Array<{ name: string; info: { when?: number } }>;
  alarmClears: string[];
} {
  const store: Record<string, unknown> = { ...initial };
  const alarmCreates: Array<{ name: string; info: { when?: number } }> = [];
  const alarmClears: string[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in store) out[k] = store[k];
          cb(out);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, obj);
          cb();
        },
        remove: (keys: string | string[], cb: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keysArr) delete store[k];
          cb();
        },
      },
    },
    alarms: {
      create: jest.fn((name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarmCreates.push({
          name,
          info: info as { when?: number },
        });
      }),
      clear: jest.fn((name: string) => {
        alarmClears.push(name);
      }),
    },
  };
  return { store, alarmCreates, alarmClears };
}

describe('getTokenExpirySeconds', () => {
  it('parses the exp claim (unix seconds) from the JWT payload', () => {
    expect(getTokenExpirySeconds(makeJwt(1893456000))).toBe(1893456000);
  });

  it('returns null for a legacy exp-less token or garbage', () => {
    expect(getTokenExpirySeconds(makeJwt(null))).toBeNull();
    expect(getTokenExpirySeconds('not-a-jwt')).toBeNull();
    expect(getTokenExpirySeconds('a.!!!.c')).toBeNull();
  });
});

describe('ensureTokenRenewal (startup / alarm arming)', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resetTokenRenewalStateForTests();
  });

  afterEach(() => {
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('schedules the alarm at exp - 24h and makes no network call when outside the window', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7 * DAY_S;
    const { alarmCreates } = installChrome({
      'cloud-sync-token': makeJwt(exp),
      'cloud-sync-api-base-url': 'http://localhost:8787',
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await ensureTokenRenewal();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(alarmCreates).toHaveLength(1);
    expect(alarmCreates[0].name).toBe(TOKEN_RENEWAL_ALARM);
    expect(alarmCreates[0].info.when).toBe(
      (exp - RENEWAL_WINDOW_SECONDS) * 1000
    );
  });

  it('renews immediately when already inside the window, persists the new token, and re-arms', async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentToken = makeJwt(now + 60 * 60); // expires in 1 h → inside window
    const newExp = now + 7 * DAY_S;
    const { store, alarmCreates } = installChrome({
      'cloud-sync-token': currentToken,
      'cloud-sync-api-base-url': 'http://localhost:8787',
    });
    const fetchMock = jest.fn(async () =>
      jsonOk({
        token: makeJwt(newExp),
        user: { id: 'u1', email: 'alice@example.com', display_name: 'Alice' },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await ensureTokenRenewal();

    // Renewed: POST /auth/renew with the current bearer token and no body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/auth/renew',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      })
    );
    const init = (
      fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    )[0][1];
    expect(init.body).toBeUndefined();

    // New token + refreshed account persisted.
    expect(store['cloud-sync-token']).toBe(makeJwt(newExp));
    expect(store['cloud-sync-account']).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    // Alarm recomputed from the NEW exp, and no retry state left behind.
    expect(alarmCreates[alarmCreates.length - 1]).toEqual({
      name: TOKEN_RENEWAL_ALARM,
      info: { when: (newExp - RENEWAL_WINDOW_SECONDS) * 1000 },
    });
    expect(await getRenewalRetryState()).toBeNull();
  });

  it('retries a transient failure with 15-minute backoff and keeps the cadence across re-checks', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { alarmCreates } = installChrome({
      'cloud-sync-token': makeJwt(now + 60 * 60),
      'cloud-sync-api-base-url': 'http://localhost:8787',
    });
    const fetchMock = jest.fn(async () => {
      throw new TypeError('network down');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const before = Date.now();
    await ensureTokenRenewal();

    const state = await getRenewalRetryState();
    expect(state?.failures).toBe(1);
    expect(state!.nextAttemptAt - before).toBeGreaterThanOrEqual(
      15 * 60_000 - 5
    );
    expect(state!.nextAttemptAt - before).toBeLessThan(15 * 60_000 + 5_000);
    expect(alarmCreates[alarmCreates.length - 1]).toEqual({
      name: TOKEN_RENEWAL_ALARM,
      info: { when: state!.nextAttemptAt },
    });

    // A second boot while the backoff is pending must NOT hit the network.
    await ensureTokenRenewal();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(alarmCreates).toHaveLength(2); // only re-armed at the same time
  });
});

describe('runTokenRenewal backoff escalation', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  const failuresFixture = async (failures: number) => {
    const now = Math.floor(Date.now() / 1000);
    const { alarmCreates } = installChrome({
      'cloud-sync-token': makeJwt(now + 60 * 60),
      'cloud-sync-api-base-url': 'http://localhost:8787',
      'cloud-sync-renewal-retry': { failures, nextAttemptAt: Date.now() - 1 },
    });
    global.fetch = jest.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    return alarmCreates;
  };

  it('escalates 15 min → 1 h → 6 h → 24 h cap', async () => {
    const cases: Array<{ failures: number; delayMs: number }> = [
      { failures: 1, delayMs: 15 * 60_000 },
      { failures: 2, delayMs: 60 * 60_000 },
      { failures: 3, delayMs: 6 * 60 * 60_000 },
      { failures: 4, delayMs: 24 * 60 * 60_000 },
      { failures: 9, delayMs: 24 * 60 * 60_000 },
    ];
    for (const { failures, delayMs } of cases) {
      resetTokenRenewalStateForTests();
      const alarmCreates = await failuresFixture(failures);
      const before = Date.now();
      const outcome = await runTokenRenewal('test');
      expect(outcome).toBe('transient');
      const state = await getRenewalRetryState();
      expect(state?.failures).toBe(failures + 1);
      expect(state!.nextAttemptAt - before).toBeGreaterThanOrEqual(delayMs - 5);
      expect(alarmCreates[alarmCreates.length - 1].info.when).toBe(
        state!.nextAttemptAt
      );
    }
  });

  it('hard 401 clears the retry state and the alarm, and stops retrying', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { alarmClears } = installChrome({
      'cloud-sync-token': makeJwt(now + 60 * 60),
      'cloud-sync-api-base-url': 'http://localhost:8787',
      'cloud-sync-renewal-retry': {
        failures: 2,
        nextAttemptAt: Date.now() - 1,
      },
    });
    const fetchMock = jest.fn(async () => jsonError(401, 'expired'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await runTokenRenewal('test');

    expect(outcome).toBe('unauthorized');
    expect(await getRenewalRetryState()).toBeNull();
    expect(alarmClears).toContain(TOKEN_RENEWAL_ALARM);
  });
});

describe('single re-auth signal + single-flight renewal', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resetTokenRenewalStateForTests();
  });

  afterEach(() => {
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  function hardExpiryFixture(): { store: Record<string, unknown> } {
    const now = Math.floor(Date.now() / 1000);
    return installChrome({
      'cloud-sync-token': makeJwt(now + 60 * 60),
      'cloud-sync-api-base-url': 'http://localhost:8787',
    });
  }

  it('fires the signal exactly once across repeated hard-401 failures (same token)', async () => {
    const { store } = hardExpiryFixture();
    global.fetch = jest.fn(async () =>
      jsonError(401, 'expired')
    ) as unknown as typeof fetch;
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    await runTokenRenewal('a');
    await runTokenRenewal('b');
    await runTokenRenewal('c');

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledWith(AUTH_EXPIRED_MESSAGE);

    // A NEW token (fresh sign-in / rotated token) starts a new episode and
    // may raise the signal again if IT hard-expires unrecoverably.
    store['cloud-sync-token'] = 'jwt-brand-new';
    await runTokenRenewal('d');
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('successful renewal re-arms the episode: a later hard 401 fires again', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { store } = installChrome({
      'cloud-sync-token': makeJwt(now + 60 * 60),
      'cloud-sync-api-base-url': 'http://localhost:8787',
    });
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    // 1) hard fail on the original token.
    global.fetch = jest.fn(async () =>
      jsonError(401, 'expired')
    ) as unknown as typeof fetch;
    await runTokenRenewal('a');
    expect(onExpired).toHaveBeenCalledTimes(1);

    // 2) the user re-authenticates; a successful renewal rotates the token.
    const newExp = Math.floor(Date.now() / 1000) + 7 * DAY_S;
    global.fetch = jest.fn(async () =>
      jsonOk({
        token: makeJwt(newExp),
        user: { id: 'u1', email: 'alice@example.com', display_name: null },
      })
    ) as unknown as typeof fetch;
    expect(await renewTokenOnce()).toBe('renewed');
    expect(store['cloud-sync-token']).toBe(makeJwt(newExp));

    // 3) the rotated token later hard-expires → the signal fires once more.
    global.fetch = jest.fn(async () =>
      jsonError(401, 'expired')
    ) as unknown as typeof fetch;
    await runTokenRenewal('b');
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('concurrent renewals share one in-flight promise (one network call)', async () => {
    hardExpiryFixture();
    let resolveFetch!: (response: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;

    const first = renewTokenOnce();
    const second = renewTokenOnce();
    const third = renewToken();

    // Let doRenewToken reach its fetch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(
      jsonOk({
        token: 'jwt-next',
        user: { id: 'u1', email: 'alice@example.com', display_name: null },
      })
    );
    expect(await first).toBe('renewed');
    expect(await second).toBe('renewed');
    expect(await third).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
