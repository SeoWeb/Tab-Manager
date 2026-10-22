import { describe, it, expect } from 'vitest';
import { corsHeaders, preflightHeaders, withCors } from '../cors';
import type { Env } from '../../types';

const ORIGIN_A = 'https://a.example';
const ORIGIN_B = 'https://b.example';

function makeEnv(overrides: Record<string, string> = {}): Env {
  return overrides as unknown as Env;
}

/** Env with the two example origins allow-listed (comma + space separated). */
function makeAllowedEnv(): Env {
  return makeEnv({ ALLOWED_ORIGINS: `${ORIGIN_A}, ${ORIGIN_B}` });
}

function makeRequest(
  headers: Record<string, string>,
  method = 'GET'
): Request {
  return new Request('https://api.example.com/v1/projects', {
    method,
    headers,
  });
}

function makePreflight(
  headers: Record<string, string>
): Request {
  return makeRequest(headers, 'OPTIONS');
}

function makeResponse(body = '{}'): Response {
  return new Response(body, { status: 200 });
}

describe('corsHeaders', () => {
  it('emits the exact allow-listed origin with credentials for a matching request', () => {
    const headers = corsHeaders(
      makeRequest({ Origin: ORIGIN_A }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN_A);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers.Vary).toBe('Origin');
  });

  it('emits no CORS headers for an unknown origin', () => {
    const headers = corsHeaders(
      makeRequest({ Origin: 'https://evil.example' }),
      makeAllowedEnv()
    );
    expect(headers).toEqual({});
  });

  it('matches origins exactly (no suffix, subdomain, port, or scheme match)', () => {
    const env = makeAllowedEnv();
    const nearMisses = [
      'https://a.example.evil.com',
      'https://api.a.example',
      'https://a.example:8443',
      'http://a.example',
    ];
    for (const origin of nearMisses) {
      expect(corsHeaders(makeRequest({ Origin: origin }), env)).toEqual({});
    }
  });

  it('emits no CORS headers when the request has no Origin header', () => {
    expect(corsHeaders(makeRequest({}), makeAllowedEnv())).toEqual({});
  });

  it('fails closed when ALLOWED_ORIGINS is unset', () => {
    const env = makeEnv();
    expect(env.ALLOWED_ORIGINS).toBeUndefined();
    expect(corsHeaders(makeRequest({ Origin: ORIGIN_A }), env)).toEqual({});
  });

  it('fails closed when ALLOWED_ORIGINS is empty or whitespace', () => {
    for (const value of ['', '   ']) {
      const env = makeEnv({ ALLOWED_ORIGINS: value });
      expect(corsHeaders(makeRequest({ Origin: ORIGIN_A }), env)).toEqual({});
    }
  });

  it('fails closed when ALLOWED_ORIGINS is "*"', () => {
    const env = makeEnv({ ALLOWED_ORIGINS: '*' });
    expect(corsHeaders(makeRequest({ Origin: ORIGIN_A }), env)).toEqual({});
  });

  it('fails closed when the allow-list contains a "*" segment', () => {
    const env = makeEnv({ ALLOWED_ORIGINS: `${ORIGIN_A}, *` });
    // Even the explicitly listed origin is denied: the list is invalid.
    expect(corsHeaders(makeRequest({ Origin: ORIGIN_A }), env)).toEqual({});
    expect(corsHeaders(makeRequest({ Origin: ORIGIN_B }), env)).toEqual({});
  });

  it('trims whitespace around configured origins and matches every entry', () => {
    const env = makeEnv({
      ALLOWED_ORIGINS: `  ${ORIGIN_A} ,  ${ORIGIN_B}  `,
    });
    for (const origin of [ORIGIN_A, ORIGIN_B]) {
      const headers = corsHeaders(makeRequest({ Origin: origin }), env);
      expect(headers['Access-Control-Allow-Origin']).toBe(origin);
    }
  });

  it('sends credentials only when the origin matches', () => {
    const env = makeAllowedEnv();
    const matched = corsHeaders(makeRequest({ Origin: ORIGIN_A }), env);
    const unmatched = corsHeaders(
      makeRequest({ Origin: 'https://evil.example' }),
      env
    );
    expect(matched['Access-Control-Allow-Credentials']).toBe('true');
    expect(unmatched).toEqual({});
  });
});

describe('preflightHeaders', () => {
  it('echoes only the requested method and headers that are allowed', () => {
    const headers = preflightHeaders(
      makePreflight({
        Origin: ORIGIN_A,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Custom-Header',
      }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN_A);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Methods']).toBe('POST');
    // X-Custom-Header is requested but not server-allowed: not echoed.
    expect(headers['Access-Control-Allow-Headers']).toBe(
      'Authorization, Content-Type'
    );
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('does not echo a disallowed request method', () => {
    const headers = preflightHeaders(
      makePreflight({
        Origin: ORIGIN_A,
        'Access-Control-Request-Method': 'PUT',
      }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN_A);
    expect(headers['Access-Control-Allow-Methods']).toBeUndefined();
  });

  it('does not emit Allow-Headers when only disallowed headers are requested', () => {
    const headers = preflightHeaders(
      makePreflight({
        Origin: ORIGIN_A,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'X-Custom, X-Other',
      }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Methods']).toBe('PATCH');
    expect(headers['Access-Control-Allow-Headers']).toBeUndefined();
  });

  it('matches requested header names case-insensitively and echoes canonical casing', () => {
    const headers = preflightHeaders(
      makePreflight({
        Origin: ORIGIN_A,
        'Access-Control-Request-Method': 'delete',
        'Access-Control-Request-Headers': 'content-type, AUTHORIZATION',
      }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Methods']).toBe('DELETE');
    expect(headers['Access-Control-Allow-Headers']).toBe(
      'Authorization, Content-Type'
    );
  });

  it('omits Allow-Methods when no request method is provided', () => {
    const headers = preflightHeaders(
      makePreflight({ Origin: ORIGIN_A }),
      makeAllowedEnv()
    );
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN_A);
    expect(headers['Access-Control-Allow-Methods']).toBeUndefined();
    expect(headers['Access-Control-Allow-Headers']).toBeUndefined();
  });

  it('emits no CORS headers at all for a non-allow-listed origin', () => {
    const headers = preflightHeaders(
      makePreflight({
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization',
      }),
      makeAllowedEnv()
    );
    expect(headers).toEqual({});
  });

  it('fails closed on preflight for wildcard or unset configuration', () => {
    for (const env of [makeEnv(), makeEnv({ ALLOWED_ORIGINS: '*' })]) {
      const headers = preflightHeaders(
        makePreflight({
          Origin: ORIGIN_A,
          'Access-Control-Request-Method': 'POST',
        }),
        env
      );
      expect(headers).toEqual({});
    }
  });
});

describe('withCors', () => {
  it('adds CORS headers for an allow-listed origin and keeps baseline security headers', () => {
    const response = withCors(
      makeResponse(),
      makeRequest({ Origin: ORIGIN_A }),
      makeAllowedEnv()
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN_A);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    );
  });

  it('never adds CORS headers for an unknown origin but still sets security headers', () => {
    const response = withCors(
      makeResponse(),
      makeRequest({ Origin: 'https://evil.example' }),
      makeAllowedEnv()
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(
      response.headers.get('Access-Control-Allow-Credentials')
    ).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    );
  });
});
