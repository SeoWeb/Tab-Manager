import { getApiBaseUrl } from './config';
import { getToken } from './authStorage';
import type {
  CloudAccount,
  CloudAcceptedInvitation,
  CloudActivityResponse,
  CloudDemoAuthResponse,
  CloudInvitation,
  CloudMember,
  CloudMemberRemoval,
  CloudMemberRoleUpdate,
  CloudMembersResponse,
  CloudMutation,
  CloudProject,
  CloudProjectDetail,
  CloudRole,
  CloudSyncResponse,
} from './types';

/** Error thrown for any non-2xx API response (or a local pre-flight failure). */
export class CloudSyncApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'CloudSyncApiError';
    this.status = status;
    this.details = details;
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof (body.error as { message: unknown }).message === 'string'
  ) {
    return (body.error as { message: string }).message;
  }
  return `Request failed (${status})`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Send the bearer token. Defaults to true; set false for `/auth/demo`. */
  auth?: boolean;
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const baseUrl = (await getApiBaseUrl()).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new CloudSyncApiError(
      0,
      'Cloud sync API URL is not configured. Set it in Settings.'
    );
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (options.auth !== false) {
    const token = await getToken();
    if (!token) {
      throw new CloudSyncApiError(401, 'Not signed in to cloud sync.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const body = text ? safeParseJson(text) : null;

  if (!response.ok) {
    throw new CloudSyncApiError(
      response.status,
      extractErrorMessage(body, response.status),
      body
    );
  }

  return body as T;
}

/** `POST /auth/demo` — exchanges an email for a demo JWT (dev only). */
export async function loginDemo(input: {
  email: string;
  displayName?: string;
}): Promise<{ token: string; account: CloudAccount }> {
  const result = await request<CloudDemoAuthResponse>('/auth/demo', {
    method: 'POST',
    auth: false,
    body: { email: input.email, display_name: input.displayName ?? null },
  });

  return {
    token: result.token,
    account: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.display_name ?? null,
    },
  };
}

/** `GET /me` — validates the stored token and returns the current user. */
export async function getCurrentUser(): Promise<{ user: CloudAccount }> {
  const result = await request<{
    user: { id: string; email: string; display_name: string | null };
  }>('/me');
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.display_name ?? null,
    },
  };
}

/** `GET /projects` — lists projects the signed-in user can access. */
export async function listProjects(): Promise<{ projects: CloudProject[] }> {
  return request<{ projects: CloudProject[] }>('/projects');
}

/** `POST /projects` — creates a project owned by the signed-in user. */
export async function createProject(input: {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}): Promise<CloudProject> {
  return request<CloudProject>('/projects', {
    method: 'POST',
    body: input,
  });
}

/**
 * `GET /projects/:projectId` — project detail plus the requesting user's role in
 * it. Phase 4 uses the role for client-side enforcement and to learn the role
 * after accepting an invite.
 */
export async function getProject(
  projectId: string
): Promise<CloudProjectDetail> {
  return request<CloudProjectDetail>(`/projects/${projectId}`);
}

/** `GET /projects/:projectId/members` — list members (requires admin). */
export async function getProjectMembers(
  projectId: string
): Promise<CloudMember[]> {
  const result = await request<CloudMembersResponse>(
    `/projects/${projectId}/members`
  );
  return result.members ?? [];
}

/**
 * `POST /projects/:projectId/invitations` — mint a single-use invite code. The
 * code is the only thing the recipient needs to join; `email` optionally locks
 * it to a specific address.
 */
export async function createProjectInvitation(
  projectId: string,
  input: { role?: CloudRole; email?: string | null; expiresInDays?: number }
): Promise<CloudInvitation> {
  return request<CloudInvitation>(`/projects/${projectId}/invitations`, {
    method: 'POST',
    body: input,
  });
}

/**
 * `POST /invitations/:code/accept` — redeem an invite. Returns the joined
 * project id and the granted role. The caller then fetches the project data.
 */
export async function acceptProjectInvitation(
  code: string
): Promise<CloudAcceptedInvitation> {
  return request<CloudAcceptedInvitation>(`/invitations/${code}/accept`, {
    method: 'POST',
  });
}

/** `PATCH /projects/:projectId/members/:userId` — change a member's role. */
export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: CloudRole
): Promise<CloudMemberRoleUpdate> {
  return request<CloudMemberRoleUpdate>(
    `/projects/${projectId}/members/${userId}`,
    { method: 'PATCH', body: { role } }
  );
}

/** `DELETE /projects/:projectId/members/:userId` — remove a member (owner only). */
export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<CloudMemberRemoval> {
  return request<CloudMemberRemoval>(
    `/projects/${projectId}/members/${userId}`,
    { method: 'DELETE' }
  );
}

/** `GET /projects/:projectId/activity` — recent change-log rows (read-only). */
export async function getProjectActivity(
  projectId: string,
  limit = 50
): Promise<CloudActivityResponse['changes']> {
  const result = await request<CloudActivityResponse>(
    `/projects/${projectId}/activity?limit=${limit}`
  );
  return result.changes ?? [];
}

/**
 * `POST /projects/:projectId/sync` — pushes local mutations and pulls changes
 * since the last cursor. The server applies mutations idempotently and returns
 * the new cursor, changes since the old one, and any conflicts.
 */
export async function syncProject(input: {
  projectId: string;
  lastCursor: number | null;
  mutations: CloudMutation[];
}): Promise<CloudSyncResponse> {
  const { projectId, lastCursor, mutations } = input;
  return request<CloudSyncResponse>(`/projects/${projectId}/sync`, {
    method: 'POST',
    body: { lastCursor, mutations },
  });
}
