import { badRequest, unauthorized } from './response';
import type { Env, JwtPayload, User } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '='
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseJwtPart<T>(part: string, label: string): T {
  try {
    return JSON.parse(decoder.decode(base64UrlDecode(part))) as T;
  } catch {
    throw new Error(`Invalid JWT ${label}`);
  }
}

export async function signJwt(
  payload: JwtPayload,
  secret: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload))
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signingInput)
  );
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;

  try {
    header = parseJwtPart(encodedHeader, 'header');
    payload = parseJwtPart(encodedPayload, 'payload');
  } catch {
    return null;
  }

  if (header.alg !== 'HS256') return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlDecode(encodedSignature);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(signingInput)
  );

  return isValid ? payload : null;
}

/**
 * Verify a raw bearer token and upsert the matching user. Shared by the standard
 * `Authorization`-header path and the realtime WebSocket route (which passes the
 * token as a query parameter because browsers cannot set request headers on a
 * `new WebSocket(...)`). Returns the user, or a 401 response.
 */
export async function authenticateToken(
  token: string,
  env: Env
): Promise<User | Response> {
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload?.sub) {
    return unauthorized('Invalid bearer token');
  }

  const email = payload.email ?? `${payload.sub}@local`;
  const displayName = payload.display_name ?? null;

  // Fast path: an existing user whose profile matches the token needs no write.
  // This keeps the steady-state auth cost at a single SELECT instead of an
  // upsert + SELECT on every authenticated request.
  const existing = await env.D1_DATABASE.prepare(
    'SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first<User>();

  if (
    existing &&
    existing.email === email &&
    (existing.display_name ?? null) === displayName
  ) {
    return existing;
  }

  const now = new Date().toISOString();
  await env.D1_DATABASE.prepare(
    `
    INSERT INTO users (id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      display_name = COALESCE(excluded.display_name, users.display_name),
      updated_at = excluded.updated_at
    `
  )
    .bind(payload.sub, email, displayName, now, now)
    .run();

  const user = await env.D1_DATABASE.prepare(
    'SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first<User>();

  return user ?? unauthorized('User not found');
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

  return authenticateToken(token, env);
}

export async function createDemoToken(
  request: Request,
  env: Env
): Promise<Response> {
  if ((env.ENABLE_DEMO_AUTH ?? 'false').toLowerCase() !== 'true') {
    return badRequest('Demo authentication is disabled in this environment');
  }

  let body: { email?: string; display_name?: string } | undefined;
  try {
    body = (await request.json()) as { email?: string; display_name?: string };
  } catch {
    return badRequest('Invalid JSON body');
  }

  const email = body.email?.trim();
  if (!email || !email.includes('@')) {
    return badRequest('A valid email is required');
  }

  // Reuse the existing user id for an email so re-issuing a demo token does not
  // collide with the UNIQUE(email) constraint (real auth providers use a stable
  // subject and never hit this; demo auth otherwise would).
  const existingUser = await env.D1_DATABASE.prepare(
    'SELECT id FROM users WHERE email = ?'
  )
    .bind(email)
    .first<{ id: string }>();

  const id = existingUser?.id ?? crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: id,
      email,
      display_name: body.display_name?.trim() || null,
      iat: now,
      exp: now + 60 * 60 * 24 * 30,
    },
    env.JWT_SECRET
  );

  return Response.json({
    token,
    user: {
      id,
      email,
      display_name: body.display_name?.trim() || null,
    },
  });
}
