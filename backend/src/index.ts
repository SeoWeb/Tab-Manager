import { withCors, preflightHeaders } from './lib/cors';
import {
  assertJwtSecret,
  getAuth,
  legacyTokenVerificationCount,
  requireUser,
  requestLoginCode,
  renewAccessToken,
  verifyLoginCode,
} from './lib/auth';
import { createRealtimeTicket } from './lib/realtime';
import {
  createInvitation,
  createProject,
  deleteProject,
  getProject,
  getProjectMembers,
  getProjectSnapshot,
  listProjects,
  removeMember,
  requireProjectAccess,
  updateMemberRole,
  updateProject,
  acceptInvitation,
  getActivity,
} from './lib/projects';
import { syncProject } from './lib/sync';
import { InvalidSnapshotCursorError } from './lib/snapshot';
import {
  badRequest,
  errorResponse,
  internalError,
  jsonResponse,
  methodNotAllowed,
  notFound,
  readJson,
} from './lib/response';
import {
  clientIp,
  enforceRateLimit,
  getRateLimitConfig,
  type RateDecision,
} from './lib/ratelimit';
import { purgeExpiredLoginCodes } from './lib/login';
import { runChangelogPruning } from './lib/changelogPruning';
import type { Env } from './types';

// Re-exported so Wrangler can find the Durable Object classes in the entry module.
export { ProjectRoom } from './lib/realtime';
export { RateLimiter } from './lib/ratelimit';

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Boot-time guard (runs once per isolate cold start): refuse to serve with a
    // missing or too-short JWT secret, which would yield forgeable tokens.
    try {
      assertJwtSecret(env.JWT_SECRET);
    } catch (error) {
      console.error('[auth] startup configuration error', error);
      return errorResponse(500, 'Server misconfiguration: JWT_SECRET is invalid');
    }

    if (request.method === 'OPTIONS') {
      return withCors(
        new Response(null, {
          status: 204,
          headers: preflightHeaders(request, env),
        }),
        request,
        env
      );
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);

    // Realtime WebSocket upgrade: handled before CORS wrapping (CORS does not
    // apply to the WebSocket handshake) and returned directly. The browser
    // cannot attach headers to a WS open, so the token arrives as `?token=`.
    if (
      segments[0] === 'projects' &&
      segments.length === 3 &&
      segments[2] === 'realtime' &&
      request.method === 'GET'
    ) {
      return handleRealtimeUpgrade(request, env, url);
    }

    // Rate limiting runs before routing: a global per-IP cap plus a tier
    // selected from the route + (cheaply decoded) auth subject. A breach
    // returns a CORS-wrapped 429; otherwise the decision's headers are attached
    // to the final response.
    const rateLimitResult = await applyRateLimiting(request, env, segments);
    if (rateLimitResult instanceof Response) {
      return withCors(rateLimitResult, request, env);
    }

    try {
      const response = await route(request, env, ctx);
      const wrapped = withCors(response, request, env);
      attachRateLimitHeaders(wrapped, rateLimitResult);
      return wrapped;
    } catch (error) {
      // Log internals server-side only; the client gets a fixed, retryable
      // error with no stack, SQL, or constraint text.
      console.error('[worker] unhandled error', error);
      return withCors(internalError(), request, env);
    }
  },

  /**
   * Nightly maintenance, routed by the exact cron expression from
   * `[triggers] crons` in wrangler.toml:
   *
   *   cron             job
   *   ---------------  --------------------------------------------------
   *   "0 3 * * *"      purge expired login codes (purgeExpiredLoginCodes)
   *   "30 3 * * *"     prune the sync_changes change log (retention window +
   *                    per-project count cap) and refresh pruning horizons
   *                    (runChangelogPruning)
   *
   * Unknown expressions log and no-op (defensive: a stray trigger must never
   * run the wrong job). Jobs are awaited inline — `scheduled` has its own
   * wall-clock budget, so `waitUntil` would add nothing.
   */
  async scheduled(controller, env, _ctx): Promise<void> {
    // Daily legacy-token census (harden-auth-tokens cutover). Tokens are only
    // observable at request time — there is nothing to count at boot — so each
    // isolate reports what IT verified since it started; the fetch-path log
    // (first legacy hit per isolate) covers the per-token detail. Counted
    // subjects are hashed, never raw.
    console.log(
      `[auth] legacy-token verifications since isolate start: ${legacyTokenVerificationCount()}`
    );
    if (controller.cron === '30 3 * * *') {
      await runChangelogPruning(env);
      return;
    }
    if (controller.cron === '0 3 * * *') {
      await purgeExpiredLoginCodes(env);
      return;
    }
    console.warn(
      `[cron] unrecognized cron expression "${controller.cron}"; no-op`
    );
  },
} satisfies ExportedHandler<Env>;

/**
 * Enforce the global per-IP limit, then a route-specific tier, returning the
 * final tier's decision (for header attachment) or a `429` `Response`.
 */
async function applyRateLimiting(
  request: Request,
  env: Env,
  segments: string[]
): Promise<RateDecision | Response> {
  const ip = clientIp(request);
  const config = getRateLimitConfig(env);

  const globalResult = await enforceRateLimit(
    env,
    `rl:global:ip:${ip}`,
    config.globalPerIp.limit,
    config.globalPerIp.windowMs
  );
  if (globalResult instanceof Response) return globalResult;

  if (segments[0] === 'auth' && segments[1] === 'request-code') {
    return enforceRateLimit(
      env,
      `rl:auth:request:ip:${ip}`,
      config.authRequest.limit,
      config.authRequest.windowMs
    );
  }

  if (segments[0] === 'auth' && segments[1] === 'verify') {
    return enforceRateLimit(
      env,
      `rl:auth:verify:ip:${ip}`,
      config.authVerify.limit,
      config.authVerify.windowMs
    );
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'sync'
  ) {
    const sub = await subjectOf(request, env);
    const key = sub ? `rl:sync:user:${sub}` : `rl:sync:ip:${ip}`;
    return enforceRateLimit(
      env,
      key,
      config.syncPerUser.limit,
      config.syncPerUser.windowMs
    );
  }

  // Everything else is the authenticated API tier.
  const sub = await subjectOf(request, env);
  const key = sub ? `rl:api:user:${sub}` : `rl:api:ip:${ip}`;
  return enforceRateLimit(
    env,
    key,
    config.apiPerUser.limit,
    config.apiPerUser.windowMs
  );
}

/**
 * Cheaply resolve the JWT subject for user-keyed rate limits. Uses the shared
 * memoized `getAuth` context, so the token verified here is not verified again
 * by the route handler's `requireUser` — one HMAC verification per request.
 */
async function subjectOf(
  request: Request,
  env: Env
): Promise<string | null> {
  const auth = await getAuth(request, env);
  return auth?.userId ?? null;
}

function attachRateLimitHeaders(response: Response, decision: RateDecision): void {
  response.headers.set('X-RateLimit-Limit', String(decision.limit));
  response.headers.set('X-RateLimit-Remaining', String(decision.remaining));
  response.headers.set(
    'X-RateLimit-Reset',
    String(Math.floor(decision.resetAt / 1000))
  );
}

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return jsonResponse({
      name: 'TabSpace Cloudflare Backend',
      status: 'ok',
      endpoints: [
        'POST /auth/request-code',
        'POST /auth/verify',
        'POST /auth/renew',
        'POST /realtime/ticket',
        'GET /me',
        'POST /projects',
        'GET /projects',
        'GET /projects/:id',
        'PATCH /projects/:id',
        'DELETE /projects/:id',
        'POST /projects/:id/sync',
        'GET /projects/:id/members',
        'PATCH /projects/:id/members/:userId',
        'DELETE /projects/:id/members/:userId',
        'POST /projects/:id/invitations',
        'POST /invitations/:code/accept',
        'GET /projects/:id/activity',
        'GET /projects/:id/snapshot',
        'GET /projects/:id/realtime (WebSocket, tabspace-auth ticket)',
      ],
    });
  }

  if (segments[0] === 'health') {
    return jsonResponse({ status: 'ok' });
  }

  if (segments[0] === 'auth' && segments[1] === 'request-code') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return requestLoginCode(request, env);
  }

  if (segments[0] === 'auth' && segments[1] === 'verify') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return verifyLoginCode(request, env);
  }

  // Silent renewal (harden-auth-tokens): authenticated with the current valid
  // bearer token — no login code re-entry. Rate limiting classifies it in the
  // authenticated per-user tier via `subjectOf` below (it carries a Bearer
  // token), so no special tier branch is needed.
  if (segments[0] === 'auth' && segments[1] === 'renew') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return renewAccessToken(request, env);
  }

  // Realtime ticket exchange (harden-auth-tokens): bearer token + projectId →
  // short-lived single-use ticket for the WebSocket subprotocol handshake.
  // Also classified in the authenticated per-user rate-limit tier.
  if (segments[0] === 'realtime' && segments[1] === 'ticket') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return createRealtimeTicket(request, env);
  }

  if (segments[0] === 'me') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return jsonResponse({ user });
  }

  if (segments[0] === 'projects' && segments.length === 1) {
    if (request.method === 'GET') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      const projects = await listProjects(env, user.id);
      return jsonResponse({ projects });
    }

    if (request.method === 'POST') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      const body = await readJson(request);
      if (body instanceof Response) return body;
      return createProject(env, user, body);
    }

    return methodNotAllowed(['GET', 'POST']);
  }

  if (segments[0] === 'projects' && segments.length === 2) {
    const projectId = segments[1];

    if (request.method === 'GET') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      const access = await requireProjectAccess(env, user.id, projectId);
      if (access instanceof Response) return access;
      const project = await getProject(env, projectId);
      if (!project) return notFound('Project not found');
      // Surface the requesting user's role so the extension can enforce it
      // client-side (e.g. hide edit controls for viewers) without a second
      // round-trip. `access` is already the resolved membership row.
      return jsonResponse({ project, role: access.role });
    }

    if (request.method === 'PATCH') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      const body = await readJson(request);
      if (body instanceof Response) return body;
      return updateProject(env, user, projectId, body);
    }

    if (request.method === 'DELETE') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      return deleteProject(env, user, projectId);
    }

    return methodNotAllowed(['GET', 'PATCH', 'DELETE']);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'sync'
  ) {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    // `ctx` lets the sync engine schedule realtime fan-out via `waitUntil`,
    // keeping the notification off the request path.
    return syncProject(env, user, segments[1], body, ctx);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'members'
  ) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return getProjectMembers(env, user, segments[1]);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 4 &&
    segments[2] === 'members'
  ) {
    const projectId = segments[1];
    const memberId = segments[3];

    if (request.method === 'PATCH') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      const body = await readJson(request);
      if (body instanceof Response) return body;
      return updateMemberRole(env, user, projectId, memberId, body);
    }

    if (request.method === 'DELETE') {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;
      return removeMember(env, user, projectId, memberId);
    }

    return methodNotAllowed(['PATCH', 'DELETE']);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'invitations'
  ) {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    return createInvitation(env, user, segments[1], body);
  }

  if (
    segments[0] === 'invitations' &&
    segments.length === 3 &&
    segments[2] === 'accept'
  ) {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return acceptInvitation(env, user, segments[1]);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'activity'
  ) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limit = parsePositiveInt(url.searchParams.get('limit'), 100);
    return getActivity(env, user, segments[1], limit);
  }

  if (
    segments[0] === 'projects' &&
    segments.length === 3 &&
    segments[2] === 'snapshot'
  ) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const access = await requireProjectAccess(
      env,
      user.id,
      segments[1],
      'viewer'
    );
    if (access instanceof Response) return access;
    return handleSnapshotRequest(
      env,
      segments[1],
      url.searchParams.get('cursor'),
      url.searchParams.get('pageSize')
    );
  }

  return notFound('Route not found');
}

/**
 * Snapshot endpoint body (auth + project access are already checked by the
 * route). Split out so the pagination contract — in particular the fixed
 * 400 for an invalid cursor — is testable without wiring full JWT auth.
 */
export async function handleSnapshotRequest(
  env: Env,
  projectId: string,
  cursor: string | null,
  pageSize: string | null
): Promise<Response> {
  try {
    const snapshot = await getProjectSnapshot(env, projectId, {
      cursor,
      pageSize,
    });
    return jsonResponse(snapshot);
  } catch (error) {
    if (error instanceof InvalidSnapshotCursorError) {
      // Fixed, client-safe message: no echo of the untrusted cursor value.
      // The hint tells clients to fall back to a cursor-less full reconcile.
      return badRequest(
        'Invalid snapshot cursor; request the snapshot without a cursor to reconcile'
      );
    }
    throw error;
  }
}

/**
 * Realtime upgrade (harden-auth-tokens). The worker performs no auth of its
 * own: the client presents a single-use realtime ticket (minted by
 * `POST /realtime/ticket`, which enforces project membership at mint time) as
 * the second `Sec-WebSocket-Protocol` entry. The upgrade request is forwarded
 * verbatim so the ticket header reaches the `ProjectRoom` DO, which verifies
 * HMAC + expiry + project binding + one-time nonce and rejects with a plain
 * 401 pre-upgrade. The `?token=` query-parameter path is gone: a token in the
 * URL is never read or honored.
 */
async function handleRealtimeUpgrade(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  try {
    assertJwtSecret(env.JWT_SECRET);
  } catch (error) {
    console.error('[auth] startup configuration error', error);
    return errorResponse(500, 'Server misconfiguration: JWT_SECRET is invalid');
  }
  if (!env.PROJECT_ROOM) {
    return errorResponse(503, 'Realtime is not configured on this deployment');
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return badRequest('Expected a WebSocket upgrade');
  }

  // The DO owns connect-time auth: ticket + one-time nonce live in DO
  // storage. The request is forwarded as-is so `Sec-WebSocket-Protocol` and
  // the `?clientId=` parameter reach the room; the project id is re-derived
  // from the room path and must match the ticket's binding.
  const projectId = url.pathname.split('/').filter(Boolean)[1] ?? '';
  const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(projectId));
  return stub.fetch(request);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}
