import { listProjects, verifyLoginCode, CloudSyncApiError } from '../client';
import { onAuthExpired, resetTokenRenewalStateForTests } from '../tokenRenewal';

/**
 * HTTP 401 handling (harden-auth-tokens, task 4.3): any API 401 triggers ONE
 * silent `POST /auth/renew` (single-flight across concurrent failures) and ONE
 * retry with the fresh token — the caller never sees the 401 when renewal
 * succeeds. A renewal that itself 401s propagates the original error and fires
 * the re-auth signal exactly once.
 */

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

function installChrome(
  initial: Record<string, unknown> = {}
): Record<string, unknown> {
  const store: Record<string, unknown> = {
    'cloud-sync-api-base-url': 'http://localhost:8787',
    'cloud-sync-token': 'jwt-current',
    ...initial,
  };
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
  };
  return store;
}

function callsTo(
  fetchMock: jest.Mock,
  suffix: string
): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith(suffix)
  ) as Array<[string, RequestInit | undefined]>;
}

describe('client 401 → renew → retry-once', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    resetTokenRenewalStateForTests();
    installChrome();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    resetTokenRenewalStateForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('renews once on 401 and retries the original request with the fresh token', async () => {
    let projectCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/projects')) {
        projectCalls += 1;
        if (projectCalls === 1) return jsonError(401, 'Token expired');
        return jsonOk({ projects: [] });
      }
      if (String(url).endsWith('/auth/renew')) return jsonOk(RENEW_OK);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await listProjects();

    expect(result).toEqual({ projects: [] });
    expect(projectCalls).toBe(2);
    // Exactly one renew call, Bearer-authenticated with the CURRENT token and
    // no body per the wire contract.
    const renewCalls = callsTo(fetchMock, '/auth/renew');
    expect(renewCalls).toHaveLength(1);
    expect(renewCalls[0][1]?.headers).toEqual({
      Authorization: 'Bearer jwt-current',
    });
    expect(renewCalls[0][1]?.body).toBeUndefined();
    // The retry carried the ROTATED token.
    const retry = callsTo(fetchMock, '/projects')[1];
    expect((retry[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-rotated'
    );
  });

  it('shares ONE renewal across concurrent 401s (single-flight)', async () => {
    let projectCalls = 0;
    let renewCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/renew')) {
        renewCalls += 1;
        return jsonOk(RENEW_OK);
      }
      if (String(url).endsWith('/projects')) {
        projectCalls += 1;
        if (projectCalls <= 2) return jsonError(401, 'Token expired');
        return jsonOk({ projects: [{ id: 'p1' }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const [a, b] = await Promise.all([listProjects(), listProjects()]);

    expect(a).toEqual({ projects: [{ id: 'p1' }] });
    expect(b).toEqual({ projects: [{ id: 'p1' }] });
    expect(projectCalls).toBe(4); // 2 failed + 2 retried
    expect(renewCalls).toBe(1); // not one per failing request
  });

  it('propagates the 401 and fires the re-auth signal once when renewal hard-fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/renew'))
        return jsonError(401, 'Token expired');
      if (String(url).endsWith('/projects'))
        return jsonError(401, 'Token expired');
      throw new Error(`unexpected fetch: ${url}`);
    });
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    await expect(listProjects()).rejects.toMatchObject({
      name: 'CloudSyncApiError',
      status: 401,
    });

    // Ticket: renewal attempted once, no retry after it failed, and the
    // single re-auth signal fired (not per request).
    expect(callsTo(fetchMock, '/auth/renew')).toHaveLength(1);
    expect(callsTo(fetchMock, '/projects')).toHaveLength(1);
    expect(onExpired).toHaveBeenCalledTimes(1);

    // A second failing request with the same expired token stays quiet.
    await expect(listProjects()).rejects.toBeInstanceOf(CloudSyncApiError);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire the re-auth signal when renewal fails transiently (offline/429)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/renew')) {
        throw new TypeError('network down');
      }
      if (String(url).endsWith('/projects'))
        return jsonError(401, 'Token expired');
      throw new Error(`unexpected fetch: ${url}`);
    });
    const onExpired = jest.fn();
    onAuthExpired(onExpired);

    await expect(listProjects()).rejects.toMatchObject({ status: 401 });

    expect(onExpired).not.toHaveBeenCalled();
  });

  it('does not loop when the retried request 401s again', async () => {
    let projectCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/renew')) return jsonOk(RENEW_OK);
      if (String(url).endsWith('/projects')) {
        projectCalls += 1;
        return jsonError(401, 'Token expired');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(listProjects()).rejects.toMatchObject({ status: 401 });

    // fetch: 401 → renew → retry 401 → throw. No second renewal, no third try.
    expect(projectCalls).toBe(2);
    expect(callsTo(fetchMock, '/auth/renew')).toHaveLength(1);
  });

  it('never retries or renews the /auth/* endpoints themselves', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/verify'))
        return jsonOk({
          token: 'jwt-new',
          user: { id: 'u1', email: 'alice@example.com', display_name: null },
        });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await verifyLoginCode({
      email: 'alice@example.com',
      code: '12345678',
    });

    expect(result).toEqual({
      token: 'jwt-new',
      account: {
        id: 'u1',
        email: 'alice@example.com',
        displayName: null,
      },
    });
    expect(callsTo(fetchMock, '/auth/renew')).toHaveLength(0);
  });
});
