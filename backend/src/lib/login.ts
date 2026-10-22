import { badRequest, errorResponse, readJson, unauthorized } from './response';
import { loginRequestSchema, loginVerifySchema, parseBody } from './validation';
import {
  getAuth,
  mintAccessToken,
  resolveUserForRead,
  resolveUserForWrite,
} from './jwt';
import type { Env, User } from '../types';
import {
  buildLoginEmail,
  EMAIL_FROM,
  LOGIN_CODE_TTL_MINUTES,
} from './email';

/** Login code lives for this many minutes before it must be re-requested. */
export const LOGIN_CODE_TTL_MS = LOGIN_CODE_TTL_MINUTES * 60 * 1000;
/** Maximum wrong-code attempts before the code is invalidated. */
export const MAX_CODE_ATTEMPTS = 5;
/** Max code requests per email within `REQUEST_WINDOW_MS` (anti email-bombing). */
const MAX_REQUESTS_PER_WINDOW = 10;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
/** Minimum gap between two sends to the same address (throttle resends). */
const MIN_REQUEST_INTERVAL_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// At-rest code protection
//
// The plaintext code is never stored. `login_codes.code` holds
// `<salt>$<sha-256(salt:code)>`, where the salt is 16 fresh random bytes
// (hex-encoded) per row and is stored alongside the digest in the same column
// (so no schema change is needed). Verification recomputes the digest from the
// submitted code and lets SQLite perform the comparison *inside* the same
// conditional DELETE/UPDATE that enforces single-use + attempt cap + expiry —
// no check is ever applied to a stale read. Migration
// 0005_purge_plaintext_login_codes.sql wiped all rows written by the old
// plaintext scheme (they could not be re-hashed: no salt was recorded).
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
/** Length of the hex salt prefix in a stored verifier. */
const SALT_HEX_LENGTH = 32;

/** `salt` + `code` → 64-char lowercase-hex SHA-256 digest (async: WebCrypto). */
export async function hashLoginCode(
  salt: string,
  code: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`${salt}:${code}`)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Build the at-rest verifier stored in `login_codes.code` for a freshly
 * generated code: `<hex salt>$<hex sha-256(salt:code)>`. A fresh salt is drawn
 * every time, so resending rotates the verifier and identical codes never
 * produce identical stored values.
 */
export async function encodeLoginCode(code: string): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${salt}$${await hashLoginCode(salt, code)}`;
}

/**
 * Split a stored verifier into its salt and digest. Returns `null` for anything
 * that does not match the `<32 hex>$<64 hex>` shape — e.g. a legacy plaintext
 * row, which can then never verify (and was wiped by migration 0005).
 */
function splitStoredCode(
  stored: string
): { salt: string; digest: string } | null {
  const separator = stored.indexOf('$');
  if (separator !== SALT_HEX_LENGTH) return null;
  const salt = stored.slice(0, separator);
  const digest = stored.slice(separator + 1);
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(digest)) {
    return null;
  }
  return { salt, digest };
}

// ---------------------------------------------------------------------------
// Code generation (uniform, no modulo bias)
// ---------------------------------------------------------------------------

/** 8-digit code space: [0, 100_000_000). */
const CODE_MODULUS = 100_000_000;
/**
 * Largest multiple of `CODE_MODULUS` below 2^32 (100_000_000 × 42 = 4.2e9).
 * Drawing a u32 and rejecting values at/above this bound makes
 * `value % CODE_MODULUS` exactly uniform: plain `%` over the full u32 range
 * would over-represent the low ~9.5% of the code space (modulo bias).
 */
const CODE_REJECT_ABOVE = CODE_MODULUS * Math.floor(
  0x1_0000_0000 / CODE_MODULUS
);

/** A cryptographically-uniform 8-digit numeric code (zero-padded). */
export function generateLoginCode(): string {
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= CODE_REJECT_ABOVE);
  return (value % CODE_MODULUS).toString().padStart(8, '0');
}

/**
 * Delete every expired login code. Cheap (backs onto
 * `idx_login_codes_expires`) and safe to run concurrently. Called lazily on
 * the request-code path, and from the worker's `scheduled` handler, so expired
 * rows never linger.
 */
export async function purgeExpiredLoginCodes(env: Env): Promise<void> {
  await env.D1_DATABASE.prepare(
    'DELETE FROM login_codes WHERE expires_at <= ?'
  )
    .bind(new Date().toISOString())
    .run();
}

/**
 * `POST /auth/request-code` — start the sign-in flow.
 *
 * Generates an 8-digit login code, stores only a salted hash of it (one active
 * code per email, upserted on resend), emails the plaintext code, and returns
 * 202 with no body. We intentionally do not reveal whether the email exists or
 * was delivered: the response is identical for known and unknown addresses so
 * the endpoint can't be used to enumerate accounts. No requester-supplied
 * display name is accepted or persisted — the address is unverified here.
 */
export async function requestLoginCode(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const parsedBody = parseBody(loginRequestSchema, parsed);
  if (!parsedBody.ok) {
    return badRequest('Invalid request', parsedBody.details);
  }

  // The schema has already trimmed, lowercased, and shape-checked the email.
  const email = parsedBody.data.email;

  // Hygiene first: drop every expired code so dead rows never linger.
  await purgeExpiredLoginCodes(env);

  // Throttle: cap requests per email per window and enforce a minimum gap
  // between consecutive sends so a script can't flood someone's inbox.
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const existing = await env.D1_DATABASE.prepare(
    `SELECT request_count, first_request_at, created_at
     FROM login_codes WHERE email = ?`
  )
    .bind(email)
    .first<{
      request_count: number;
      first_request_at: string;
      created_at: string;
    }>();

  const requestCount = existing
    ? nowMs - new Date(existing.first_request_at).getTime() > REQUEST_WINDOW_MS
      ? 1
      : existing.request_count + 1
    : 1;
  const firstRequestAt = existing ? existing.first_request_at : nowIso;

  if (existing) {
    if (requestCount > MAX_REQUESTS_PER_WINDOW) {
      // Still 202 so we don't leak that the address is rate-limited.
      return new Response(null, { status: 202 });
    }
    const lastMs = new Date(existing.created_at).getTime();
    if (nowMs - lastMs < MIN_REQUEST_INTERVAL_MS) {
      return new Response(null, { status: 202 });
    }
  }

  const code = generateLoginCode();
  const expiresAt = new Date(nowMs + LOGIN_CODE_TTL_MS).toISOString();
  const storedCode = await encodeLoginCode(code);

  await env.D1_DATABASE.prepare(
    `
    INSERT INTO login_codes
      (email, code, expires_at, created_at, attempts, request_count, first_request_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code = excluded.code,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at,
      attempts = 0,
      request_count = excluded.request_count,
      first_request_at = excluded.first_request_at
    `
  )
    .bind(email, storedCode, expiresAt, nowIso, requestCount, firstRequestAt)
    .run();

  // Neutral copy only: nothing requester-supplied is ever interpolated here.
  const { subject, html, text } = buildLoginEmail(code);
  try {
    if (!env.EMAIL) {
      throw new Error('EMAIL binding is not configured');
    }
    await env.EMAIL.send({
      to: email,
      from: EMAIL_FROM,
      subject,
      html,
      text,
    });
  } catch (error) {
    console.error('[auth] failed to send login email', error);
    return errorResponse(502, 'Could not send the login email');
  }

  // 202 Accepted: the code is on its way, but we never confirm delivery here.
  return new Response(null, { status: 202 });
}

/**
 * `POST /auth/verify` — complete the sign-in flow.
 *
 * Security model (all enforcement is single-statement, so concurrent requests
 * can never both win):
 *
 * 1. Single-use consume — a JWT is minted only when this exact conditional
 *    DELETE reports one row removed:
 *      DELETE FROM login_codes
 *      WHERE email = ? AND code = ? AND attempts < ? AND expires_at > ?
 *    Two concurrent verifies of the same code race on that DELETE; SQLite/D1
 *    serializes it, exactly one sees `meta.changes = 1`.
 * 2. Atomic attempt counting — a wrong code increments the counter with one
 *    conditional UPDATE:
 *      UPDATE login_codes SET attempts = attempts + 1
 *      WHERE email = ? AND attempts < ? AND expires_at > ?
 *    (Deliberately NOT matched on the code hash: a wrong code hashes to a
 *    different verifier, so a hash-matching UPDATE could never fire and the
 *    cap would be unenforceable.) At the cap the UPDATE matches 0 rows and the
 *    code is unusable — including for the correct code, because the consume
 *    DELETE re-checks `attempts < max` inside the same statement. A wrong
 *    attempt never consumes the code.
 * 3. Expiry — enforced by `expires_at` in both statements above, and expired
 *    rows are purged on access so they don't linger.
 *
 * Responses are opaque: invalid / wrong / exhausted all return 401 without
 * revealing which.
 */
export async function verifyLoginCode(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const parsedBody = parseBody(loginVerifySchema, parsed);
  if (!parsedBody.ok) {
    return badRequest('Invalid request', parsedBody.details);
  }

  const email = parsedBody.data.email;
  const code = parsedBody.data.code;

  const row = await env.D1_DATABASE.prepare(
    `SELECT code, expires_at, attempts
     FROM login_codes WHERE email = ?`
  )
    .bind(email)
    .first<{ code: string; expires_at: string; attempts: number }>();

  if (!row) {
    return unauthorized('Invalid or expired code');
  }

  const nowIso = new Date().toISOString();

  // Expired: purge the dead row so it doesn't linger, then reject. The DELETE
  // is guarded by `expires_at <= ?` so it can never remove a row a concurrent
  // request-code just refreshed.
  if (Date.now() >= new Date(row.expires_at).getTime()) {
    await env.D1_DATABASE.prepare(
      'DELETE FROM login_codes WHERE email = ? AND expires_at <= ?'
    )
      .bind(email, nowIso)
      .run();
    return unauthorized('Invalid or expired code');
  }

  // Exhausted: reject up front for the precise message. Enforcement is *not*
  // trusted to this read — both statements below re-check the cap atomically.
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    return unauthorized('Too many attempts. Please request a new code.');
  }

  const stored = splitStoredCode(row.code);
  if (!stored) {
    // Unrecognized verifier format (legacy plaintext row; wiped by migration
    // 0005). It can never verify — reject without consuming, expiry will reap it.
    return unauthorized('Invalid or expired code');
  }

  // Recompute the verifier for the submitted code. The comparison itself
  // happens inside SQLite (the `code = ?` predicate below), not in JS.
  const candidate = `${stored.salt}$${await hashLoginCode(stored.salt, code)}`;

  // (1) Atomic single-use consume: mint a token only when exactly one row was
  // removed by this statement.
  const consumed = await env.D1_DATABASE.prepare(
    `DELETE FROM login_codes
     WHERE email = ? AND code = ? AND attempts < ? AND expires_at > ?`
  )
    .bind(email, candidate, MAX_CODE_ATTEMPTS, nowIso)
    .run();

  if (consumed.meta.changes === 1) {
    const user = await ensureUser(env, email);

    // Centralized mint (harden-auth-tokens): bounded TTL + fresh jti.
    const token = await mintAccessToken(env, {
      sub: user.id,
      email: user.email,
      display_name: user.display_name,
    });

    return Response.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
      },
    });
  }

  // (2) Atomic attempt counting: one conditional increment for a wrong code.
  // Never consumes the row; matches 0 rows once the cap is reached, after
  // which the code is unusable.
  const bumped = await env.D1_DATABASE.prepare(
    `UPDATE login_codes SET attempts = attempts + 1
     WHERE email = ? AND attempts < ? AND expires_at > ?`
  )
    .bind(email, MAX_CODE_ATTEMPTS, nowIso)
    .run();

  if (bumped.meta.changes === 1) {
    return unauthorized('Incorrect code');
  }

  // The row vanished (concurrent consume / purge) or the cap was hit between
  // the SELECT and here. Same opaque answer either way.
  return unauthorized('Invalid or expired code');
}

/**
 * Resolve (or create) the user row for a verified email. Reuses the existing id
 * so re-logging in never collides with the UNIQUE(email) constraint or orphans
 * projects the user already owns. New users start with a `null` display name:
 * login no longer accepts requester-supplied names for unverified addresses.
 */
async function ensureUser(env: Env, email: string): Promise<User> {
  const existing = await env.D1_DATABASE.prepare(
    'SELECT id, email, display_name, created_at, updated_at FROM users WHERE email = ?'
  )
    .bind(email)
    .first<User>();

  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.D1_DATABASE.prepare(
    `INSERT INTO users (id, email, display_name, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)`
  )
    .bind(id, email, now, now)
    .run();

  return {
    id,
    email,
    display_name: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Resolve the caller for a route handler. The bearer token is HMAC-verified at
 * most once per request: `getAuth` memoizes the auth context on the Request,
 * and the rate limiter's `subjectOf` shares the same context, so a request
 * that passes through rate limiting and then a handler performs exactly one
 * verification.
 *
 * Reads (GET) trust the token's claims and skip the per-request user upsert;
 * writes keep the SELECT + conditional-upsert behavior so the `users` row
 * always exists and tracks the token's profile claims.
 */
export async function requireUser(
  request: Request,
  env: Env
): Promise<User | Response> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return unauthorized('Missing bearer token');
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorized('Missing bearer token');
  }

  const auth = await getAuth(request, env);
  if (!auth) {
    return unauthorized('Invalid bearer token');
  }

  if (request.method === 'GET') {
    return resolveUserForRead(env, auth);
  }
  return resolveUserForWrite(env, auth);
}

/**
 * `POST /auth/renew` — mint a fresh access token for the caller.
 *
 * Requires a valid current bearer token (no login code re-entry): this is the
 * silent-renewal endpoint the extension's background worker calls before the
 * stored token expires. The response shape mirrors `POST /auth/verify` exactly
 * (`{token, user}`) so the client can swap the stored token transparently. The
 * old token remains valid until its natural expiry (no revocation yet — `jti`
 * is groundwork). Rate limiting classifies this route in the authenticated
 * per-user tier because it carries a Bearer token.
 */
export async function renewAccessToken(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const token = await mintAccessToken(env, {
    sub: user.id,
    email: user.email,
    display_name: user.display_name,
  });

  return Response.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
}
