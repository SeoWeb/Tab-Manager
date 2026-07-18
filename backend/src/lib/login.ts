import { badRequest, errorResponse, readJson, unauthorized } from './response';
import { signJwt } from './jwt';
import type { Env, User } from '../types';
import {
  buildLoginEmail,
  EMAIL_FROM,
  LOGIN_CODE_TTL_MINUTES,
} from './email';

/** Login code lives for this many minutes before it must be re-requested. */
export const LOGIN_CODE_TTL_MS = LOGIN_CODE_TTL_MINUTES * 60 * 1000;
/** Maximum wrong-code attempts before the code is invalidated. */
const MAX_CODE_ATTEMPTS = 5;
/** Max code requests per email within `REQUEST_WINDOW_MS` (anti email-bombing). */
const MAX_REQUESTS_PER_WINDOW = 10;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
/** Minimum gap between two sends to the same address (throttle resends). */
const MIN_REQUEST_INTERVAL_MS = 30 * 1000;

/** A cryptographically-random 8-digit numeric code (left-padded with zeros). */
function generateLoginCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (b) => (b % 10).toString()).join('');
  return code;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * `POST /auth/request-code` — start the sign-in flow.
 *
 * Generates an 8-digit login code, stores it (one active code per email,
 * upserted on resend), emails it, and returns 202 with no body. We intentionally
 * do not reveal whether the email exists or was delivered: the response is
 * identical for known and unknown addresses so the endpoint can't be used to
 * enumerate accounts.
 */
export async function requestLoginCode(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { email?: string; display_name?: string };

  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return badRequest('A valid email is required');
  }
  const displayName = body.display_name?.trim() || null;

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

  await env.D1_DATABASE.prepare(
    `
    INSERT INTO login_codes
      (email, code, display_name, expires_at, created_at, attempts, request_count, first_request_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code = excluded.code,
      display_name = COALESCE(excluded.display_name, login_codes.display_name),
      expires_at = excluded.expires_at,
      created_at = excluded.created_at,
      attempts = 0,
      request_count = excluded.request_count,
      first_request_at = excluded.first_request_at
    `
  )
    .bind(
      email,
      code,
      displayName,
      expiresAt,
      nowIso,
      requestCount,
      firstRequestAt
    )
    .run();

  const { subject, html, text } = buildLoginEmail(code, displayName);
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
 * Checks the submitted code against the stored (non-expired) row. On a match we
 * issue a JWT, delete the code (single-use), ensure a user row exists, and
 * return `{ token, user }`. Wrong or expired codes increment an attempt counter
 * and return 401; too many attempts permanently invalidate the code.
 */
export async function verifyLoginCode(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { email?: string; code?: string };

  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();
  if (!email || !isValidEmail(email) || !/^\d{8}$/.test(code ?? '')) {
    return badRequest('A valid email and 8-digit code are required');
  }

  const row = await env.D1_DATABASE.prepare(
    `SELECT code, display_name, expires_at, attempts
     FROM login_codes WHERE email = ?`
  )
    .bind(email)
    .first<{
      code: string;
      display_name: string | null;
      expires_at: string;
      attempts: number;
    }>();

  if (!row) {
    return unauthorized('Invalid or expired code');
  }

  const expired = Date.now() > new Date(row.expires_at).getTime();
  if (expired) {
    await env.D1_DATABASE.prepare('DELETE FROM login_codes WHERE email = ?')
      .bind(email)
      .run();
    return unauthorized('Invalid or expired code');
  }

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await env.D1_DATABASE.prepare('DELETE FROM login_codes WHERE email = ?')
      .bind(email)
      .run();
    return unauthorized('Too many attempts. Please request a new code.');
  }

  if (row.code !== code) {
    await env.D1_DATABASE.prepare(
      'UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?'
    )
      .bind(email)
      .run();
    return unauthorized('Incorrect code');
  }

  // Single-use: consume the code immediately on success.
  await env.D1_DATABASE.prepare('DELETE FROM login_codes WHERE email = ?')
    .bind(email)
    .run();

  const user = await ensureUser(env, email, row.display_name);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      display_name: user.display_name,
      iat: now,
      exp: now + 60 * 60 * 24 * 30,
    },
    env.JWT_SECRET
  );

  return Response.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
}

/**
 * Resolve (or create) the user row for a verified email. Reuses the existing id
 * so re-logging in never collides with the UNIQUE(email) constraint or orphans
 * projects the user already owns.
 */
async function ensureUser(
  env: Env,
  email: string,
  displayName: string | null
): Promise<User> {
  const existing = await env.D1_DATABASE.prepare(
    'SELECT id, email, display_name, created_at, updated_at FROM users WHERE email = ?'
  )
    .bind(email)
    .first<User>();

  if (existing) {
    // Keep a freshly provided display name in sync if we didn't have one yet.
    if (displayName && !existing.display_name) {
      await env.D1_DATABASE.prepare(
        'UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?'
      )
        .bind(displayName, new Date().toISOString(), existing.id)
        .run();
      return { ...existing, display_name: displayName };
    }
    return existing;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.D1_DATABASE.prepare(
    `INSERT INTO users (id, email, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, email, displayName, now, now)
    .run();

  return {
    id,
    email,
    display_name: displayName,
    created_at: now,
    updated_at: now,
  };
}

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

  const { authenticateToken } = await import('./jwt');
  return authenticateToken(token, env);
}
