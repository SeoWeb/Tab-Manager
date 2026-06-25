import { withCors, preflightHeaders } from './lib/cors';
import { authenticateToken, createDemoToken, requireUser } from './lib/auth';
import {
  createInvitation,
  createProject,
  deleteProject,
  getProject,
  getProjectMembers,
  listProjects,
  removeMember,
  requireProjectAccess,
  updateMemberRole,
  updateProject,
  acceptInvitation,
  getActivity,
} from './lib/projects';
import { syncProject } from './lib/sync';
// Re-exported so Wrangler can find the Durable Object class in the entry module.
export { ProjectRoom } from './lib/realtime';
import {
  badRequest,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  notFound,
} from './lib/response';
import type { Env } from './types';

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

    try {
      const response = await route(request, env, ctx);
      return withCors(response, request, env);
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
        'POST /auth/demo',
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
        'GET /projects/:id/realtime (WebSocket)',
      ],
    });
  }

  if (segments[0] === 'health') {
    return jsonResponse({ status: 'ok' });
  }

  if (segments[0] === 'auth' && segments[1] === 'demo') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return createDemoToken(request, env);
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

async function readJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return badRequest('Content-Type must be application/json');
  }

  try {
    return (await request.json()) as unknown;
  } catch {
    return badRequest('Invalid JSON body');
  }
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}
