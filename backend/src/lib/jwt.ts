import { unauthorized } from './response';
import type { Env, JwtPayload, User } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Minimum JWT secret length (32 chars ≈ 256-bit) to prevent forgeable tokens. */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Fail fast if the signing secret is missing or too weak. `crypto.subtle`
 * happily imports an empty/short key, which yields HMAC tokens an attacker can
 * forge, so we assert strength before any token is signed or verified.
 */
export function assertJwtSecret(secret: string | undefined): void {
  if (!secret || secret.trim().length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is not configured or too short (min ${MIN_JWT_SECRET_LENGTH} characters). Refusing to start with a forgeable signing key.`
    );
  }
}

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

// ---------------------------------------------------------------------------
// Token minting (harden-auth-tokens)
//
// Every token minted after this change carries `exp` (bounded lifetime) and a
// unique `jti` (revocation groundwork). All mint sites must go through
// `mintAccessToken` so neither claim can be forgotten.
// ---------------------------------------------------------------------------

/** Default access-token lifetime: 7 days. */
export const DEFAULT_TOKEN_TTL_SECONDS = 604_800;
/** Hard cap on the configured lifetime: 30 days. */
export const MAX_TOKEN_TTL_SECONDS = 2_592_000;
/** Floor on the configured lifetime: 1 minute (guard against misconfiguration). */
export const MIN_TOKEN_TTL_SECONDS = 60;

/**
 * Resolve the configured access-token lifetime. Unset/invalid values fall back
 * to the 7-day default; parsed values are clamped to [1 minute, 30 days].
 */
export function resolveTokenTtlSeconds(
  env: Pick<Env, 'TOKEN_TTL_SECONDS'>
): number {
  const parsed = Number.parseInt(env.TOKEN_TTL_SECONDS ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TOKEN_TTL_SECONDS;
  return Math.min(
    Math.max(parsed, MIN_TOKEN_TTL_SECONDS),
    MAX_TOKEN_TTL_SECONDS
  );
}

/** Identity claims a freshly minted access token carries. */
export interface MintClaims {
  sub: string;
  email?: string;
  display_name?: string | null;
}

/**
 * Mint a bearer access token: `exp = now + TOKEN_TTL_SECONDS` (clamped) and a
 * fresh `jti` on every call, so two tokens minted in the same instant remain
 * distinguishable (required for any future revocation list).
 */
export async function mintAccessToken(
  env: Env,
  claims: MintClaims
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: claims.sub,
      email: claims.email,
      display_name: claims.display_name,
      iat: now,
      exp: now + resolveTokenTtlSeconds(env),
      jti: crypto.randomUUID(),
    },
    env.JWT_SECRET
  );
}

export interface JwtVerifyResult {
  payload: JwtPayload;
  /**
   * True when the token is valid but predates harden-auth-tokens: it lacks
   * `exp` (never-expiring legacy token) or `jti`. Legacy tokens stay valid
   * during the migration window unless `REQUIRE_EXP_ON_ALL_TOKENS` is set.
   */
  legacy: boolean;
}

/**
 * Verify a token and report its migration status. `options.requireExp`
 * (the `REQUIRE_EXP_ON_ALL_TOKENS=1` cutover) rejects exp-less tokens as
 * unauthenticated; jti-less tokens are tolerated even in strict mode — only
 * `exp` is enforced.
 */
export async function verifyJwtDetailed(
  token: string,
  secret: string,
  options: { requireExp?: boolean } = {}
): Promise<JwtVerifyResult | null> {
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

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) return null;
  // Cutover: exp-less (legacy) tokens are rejected, everything else still
  // verifies normally. jti-less tokens are NOT rejected in strict mode.
  if (options.requireExp && payload.exp === undefined) return null;

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

  if (!isValid) return null;
  return { payload, legacy: payload.exp === undefined || payload.jti === undefined };
}

/** Thin wrapper kept for existing callers that only need the payload. */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const result = await verifyJwtDetailed(token, secret);
  return result?.payload ?? null;
}

// ---------------------------------------------------------------------------
// Request-scoped auth context (harden-auth-tokens)
//
// `subjectOf` (rate limiting) and `requireUser` (handlers) previously each
// HMAC-verified the same bearer token — two verifications per request. The
// context below is memoized on the Request object, so the token is verified
// exactly once no matter how many helpers consume it. Requests are not
// retained past handler return in this codebase (audited), so the WeakMap
// dies with the request; isolate lifetime of the entries is acceptable.
// ---------------------------------------------------------------------------

/** Per-request authentication state shared by all auth consumers. */
export interface AuthContext {
  userId: string;
  payload: JwtPayload;
  /** Token predates the exp/jti hardening (valid, migration-tolerated). */
  legacy: boolean;
  /**
   * Resolved user row, set by the write-path resolver and memoized with the
   * context. Reads do not populate it (they trust token claims).
   */
  user?: User;
}

const authContextCache = new WeakMap<Request, AuthContext | null>();

/**
 * `REQUIRE_EXP_ON_ALL_TOKENS=1` — migration cutover that rejects exp-less
 * legacy tokens. jti-less tokens stay tolerated.
 */
export function strictExpRequired(env: Env): boolean {
  return env.REQUIRE_EXP_ON_ALL_TOKENS === '1';
}

/**
 * Memoized per-request auth: verifies the bearer token once per request and
 * caches the result (including the negative result — an invalid token is not
 * re-verified by a later consumer on the same request).
 */
export async function getAuth(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  if (authContextCache.has(request)) {
    return authContextCache.get(request) ?? null;
  }
  const context = await verifyBearerToken(request, env);
  authContextCache.set(request, context);
  return context;
}

async function verifyBearerToken(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;

  const result = await verifyJwtDetailed(token, env.JWT_SECRET, {
    requireExp: strictExpRequired(env),
  });
  if (!result?.payload.sub) return null;
  if (result.legacy) await logLegacyTokenOnce(result.payload);
  return {
    userId: result.payload.sub,
    payload: result.payload,
    legacy: result.legacy,
  };
}

// --- Legacy-token migration logging ----------------------------------------

/**
 * Once-per-isolate flag: legacy tokens are common during migration, so the
 * warning must not fire per request. Never logs raw tokens, jtis, or subjects.
 */
let legacyTokenLogged = false;

/**
 * Running count of legacy (pre-hardening) token verifications in this
 * isolate. Tokens are only observable at request time, so there is nothing to
 * count at boot — the first legacy hit logs the detail (hashed subject) and
 * the cron's daily summary reports this counter (harden-auth-tokens cutover).
 */
let legacyTokenVerifications = 0;

/** Current in-isolate count of legacy token verifications. */
export function legacyTokenVerificationCount(): number {
  return legacyTokenVerifications;
}

/** sha-256 hex digest of `input` (used to hash subjects before logging). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function logLegacyTokenOnce(payload: JwtPayload): Promise<void> {
  legacyTokenVerifications += 1;
  if (legacyTokenLogged) return;
  legacyTokenLogged = true;
  // Only a truncated hash of the subject is logged — enough to correlate
  // growth of the legacy population, never enough to identify a user or
  // replay a token.
  const subjectHash = (await sha256Hex(payload.sub)).slice(0, 12);
  console.warn(
    `[auth] legacy token accepted (missing ${payload.exp === undefined ? 'exp' : 'jti'}); subject sha256:${subjectHash}; legacy-token verifications since isolate start: ${legacyTokenVerifications}`
  );
}

// --- First-seen jti bookkeeping ----------------------------------------------

/**
 * Isolate-local set of already-bookkept token ids (or `sub:`-prefixed subjects
 * for legacy tokens, which have no jti). Bounded FIFO: the oldest entry is
 * evicted at 1000 entries. A first-seen id allows one idempotent user upsert
 * on an otherwise read-only request; every later request with the same token
 * performs zero user-table D1 work. Isolate-local is sufficient: worst case
 * after an eviction/restart is one extra idempotent upsert.
 */
const SEEN_AUTH_KEYS_LIMIT = 1000;
const seenAuthKeys = new Set<string>();

function markAuthKeySeen(key: string): void {
  if (seenAuthKeys.has(key)) return;
  if (seenAuthKeys.size >= SEEN_AUTH_KEYS_LIMIT) {
    const oldest = seenAuthKeys.values().next().value;
    if (oldest !== undefined) seenAuthKeys.delete(oldest);
  }
  seenAuthKeys.add(key);
}

// --- User resolution ---------------------------------------------------------

/**
 * Reads trust token claims: synthesize the user without any D1 round-trip.
 * `created_at`/`updated_at` fall back to the token's `iat` (no GET handler
 * consumes them — audited; `GET /me` clients read id/email/display_name only).
 */
export function synthesizeUser(payload: JwtPayload): User {
  const timestamp = payload.iat
    ? new Date(payload.iat * 1000).toISOString()
    : new Date().toISOString();
  return {
    id: payload.sub,
    email: payload.email ?? `${payload.sub}@local`,
    display_name: payload.display_name ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * SELECT + conditional upsert from verified claims (the pre-existing
 * `authenticateToken` behavior). Write paths keep this; it guarantees the
 * `users` row exists and matches the token's profile claims.
 */
async function upsertUserFromClaims(
  env: Env,
  payload: JwtPayload
): Promise<User | Response> {
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

/**
 * Read-path user resolution: trust the token's claims (no mandatory D1 work).
 * The only exception is first-seen `jti` bookkeeping, which performs one
 * idempotent upsert so the `users` row comes into existence without putting
 * writes on every read. Later requests with the same token do zero D1 work.
 */
export async function resolveUserForRead(
  env: Env,
  auth: AuthContext
): Promise<User | Response> {
  const key = auth.payload.jti ?? `sub:${auth.userId}`;
  if (!seenAuthKeys.has(key)) {
    markAuthKeySeen(key);
    await upsertUserFromClaims(env, auth.payload);
  }
  return synthesizeUser(auth.payload);
}

/**
 * Write-path user resolution: SELECT + conditional upsert (today's behavior),
 * memoized onto the request's auth context so a second consumer on the same
 * request does not repeat the D1 round-trip.
 */
export async function resolveUserForWrite(
  env: Env,
  auth: AuthContext
): Promise<User | Response> {
  if (auth.user) return auth.user;
  const user = await upsertUserFromClaims(env, auth.payload);
  if (!(user instanceof Response)) auth.user = user;
  return user;
}

/**
 * Verify a raw bearer token and upsert the matching user. Kept as the
 * raw-token primitive behind the auth barrel: request-scoped consumers use the
 * memoized `getAuth` / `requireUser` instead, and the realtime WebSocket route
 * now authenticates with single-use tickets (harden-auth-tokens) rather than
 * bearer tokens, so nothing passes tokens by URL anymore. Returns the user,
 * or a 401 response.
 */
export async function authenticateToken(
  token: string,
  env: Env
): Promise<User | Response> {
  const result = await verifyJwtDetailed(token, env.JWT_SECRET, {
    requireExp: strictExpRequired(env),
  });
  if (!result?.payload.sub) {
    return unauthorized('Invalid bearer token');
  }
  if (result.legacy) await logLegacyTokenOnce(result.payload);
  return upsertUserFromClaims(env, result.payload);
}
