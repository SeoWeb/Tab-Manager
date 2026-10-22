import type { Env } from '../types';

/**
 * Fixed, server-side preflight allow-lists. Client-requested methods and
 * headers are only ever *intersected* against these lists; arbitrary client
 * values are never copied into response headers.
 */
const ALLOWED_PREFLIGHT_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_PREFLIGHT_HEADERS = ['Authorization', 'Content-Type'];

const PREFLIGHT_MAX_AGE = '86400';

/**
 * Warn-once guard so a misconfigured deployment logs a single warning per
 * isolate instead of one per request (Workers have no long-lived startup
 * hook, so the check happens lazily on first use).
 */
const warnedMisconfigurations = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedMisconfigurations.has(key)) return;
  warnedMisconfigurations.add(key);
  console.warn(`[cors] ${message}`);
}

/**
 * Parse `ALLOWED_ORIGINS` (comma-separated exact origins) into an allow-list.
 *
 * Fails closed:
 * - unset/empty value  -> empty list (no CORS headers on any response)
 * - a `*` segment      -> treated as invalid configuration; the whole list is
 *                         rejected. Wildcard origins are incompatible with
 *                         `Access-Control-Allow-Credentials: true`.
 */
function parseAllowedOrigins(env: Env): string[] {
  const configured = env.ALLOWED_ORIGINS?.trim();
  if (!configured) {
    warnOnce(
      'unset-origins',
      'ALLOWED_ORIGINS is not configured; cross-origin requests are denied (fail closed).'
    );
    return [];
  }

  const origins = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    warnOnce(
      'wildcard-origin',
      'ALLOWED_ORIGINS contains "*" which is not permitted with credentialed CORS; cross-origin requests are denied (fail closed).'
    );
    return [];
  }

  return origins;
}

/**
 * Return the request origin if and only if it appears EXACTLY in the
 * configured allow-list (string equality; no pattern or suffix matching).
 * A request without an `Origin` header is same-origin/non-CORS and gets none.
 */
function resolveOrigin(request: Request, env: Env): string | null {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) return null;

  const allowedOrigins = parseAllowedOrigins(env);
  if (!allowedOrigins.includes(requestOrigin)) return null;

  return requestOrigin;
}

/**
 * CORS headers for a (non-preflight) response. Empty unless the request
 * origin is explicitly allow-listed; credentials are only ever sent for an
 * explicitly allow-listed origin.
 */
export function corsHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = resolveOrigin(request, env);
  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

/**
 * Headers for an `OPTIONS` preflight. Only allow-listed origins get any CORS
 * headers at all. Requested methods/headers are intersected with the fixed
 * server-side lists above; disallowed or missing values are simply omitted,
 * which makes the browser reject the preflight.
 */
export function preflightHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = resolveOrigin(request, env);
  if (!origin) return {};

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
    Vary: 'Origin',
  };

  const requestMethod = request.headers.get('Access-Control-Request-Method');
  if (requestMethod) {
    const method = requestMethod.trim().toUpperCase();
    if (ALLOWED_PREFLIGHT_METHODS.includes(method)) {
      // Echo the single canonical method that was requested AND allowed.
      headers['Access-Control-Allow-Methods'] = method;
    }
  }

  const requestHeaders = request.headers.get('Access-Control-Request-Headers');
  if (requestHeaders) {
    const requested = requestHeaders
      .split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    const allowed = ALLOWED_PREFLIGHT_HEADERS.filter((header) =>
      requested.includes(header.toLowerCase())
    );
    if (allowed.length > 0) {
      // Echo canonical server-side casing, never the raw client value.
      headers['Access-Control-Allow-Headers'] = allowed.join(', ');
    }
  }

  return headers;
}

export function withCors(
  response: Response,
  request: Request,
  env: Env
): Response {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  // Baseline security headers on every response (success and error alike).
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}
