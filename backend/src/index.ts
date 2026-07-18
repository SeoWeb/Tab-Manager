import { withCors, preflightHeaders } from './lib/cors';
import {
  authenticateToken,
  requireUser,
  requestLoginCode,
  verifyLoginCode,
} from './lib/auth';
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
import {
  badRequest,
  errorResponse,
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
import { verifyJwt } from './lib/auth';
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
      console.error(error);
      return withCors(
        errorResponse(500, 'Internal server error'),
        request,
        env
      );
    }
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

/** Cheaply decode the JWT subject (no D1 lookup) for user-keyed rate limits. */
async function subjectOf(
  request: Request,
  env: Env
): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  return payload?.sub ?? null;
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
        'GET /projects/:id/realtime (WebSocket)',
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
    return syncProject(env, user, segments[1], body);
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
    const snapshot = await getProjectSnapshot(env, segments[1]);
    return jsonResponse(snapshot);
  }

  return notFound('Route not found');
}

/**
 * Phase 5 realtime upgrade. Authenticates the `?token=` query parameter,
 * verifies the user is a member of the project (viewer+), then forwards the
 * WebSocket upgrade to the project's Durable Object, stamping the user's
 * identity onto headers the DO trusts for presence.
 */
async function handleRealtimeUpgrade(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (!env.PROJECT_ROOM) {
    return errorResponse(503, 'Realtime is not configured on this deployment');
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return badRequest('Expected a WebSocket upgrade');
  }

  const token = url.searchParams.get('token') ?? '';
  const user = await authenticateToken(token, env);
  if (user instanceof Response) return user;

  const projectId = url.pathname.split('/').filter(Boolean)[1] ?? '';
  const access = await requireProjectAccess(env, user.id, projectId);
  if (access instanceof Response) return access;

  // Forward the upgrade to the DO, carrying identity so presence tags can be
  // built server-side. The display name is URL-encoded to survive non-ASCII /
  // header-unfriendly characters.
  const headers = new Headers(request.headers);
  headers.set('X-User-Id', user.id);
  headers.set('X-User-Name', encodeURIComponent(user.display_name ?? ''));
  headers.set('X-User-Role', access.role);
  headers.set('X-Client-Id', url.searchParams.get('clientId') ?? '');

  const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(projectId));
  return stub.fetch(new Request(request, { headers }));
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}
