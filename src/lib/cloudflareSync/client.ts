import { getApiBaseUrl } from './config';
import { getToken } from './authStorage';
import { parseAuthResponse, renewToken } from './tokenRenewal';
import type {
  CloudAccount,
  CloudAcceptedInvitation,
  CloudActivityResponse,
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
  CloudVerifyResponse,
  SnapshotCollection,
  SnapshotEntityTypeName,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotNextCursors,
  SnapshotPaginationParams,
  SnapshotResponse,
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
  /** Send the bearer token. Defaults to true; set false for `/auth/*`. */
  auth?: boolean;
  /**
   * Internal: this call is already the single post-renewal retry, so a second
   * 401 must propagate instead of renewing again (no loops).
   */
  retriedAfterRenewal?: boolean;
}

/**
 * Hard cap on a single API request, covering both the response headers and the
 * body read (fix-cross-context-data-loss, task 3.2). Without it a hung request
 * never settles — and the background sync path would hold the advisory sync
 * lock (kept fresh by its heartbeat) indefinitely. Each attempt gets its OWN
 * controller, so the one post-renewal retry is not charged the first attempt's
 * wait. On abort a retryable transport error is thrown; it deliberately does
 * NOT look like a 401, so the renew-once flow is never triggered by a timeout.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted || (error instanceof Error && error.name === 'AbortError')
  );
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

  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    // Read the body inside the same timeout window: a server that sends
    // headers but stalls the body must time out too.
    text = await response.text();
  } catch (error) {
    if (isAbort(error, controller.signal)) {
      // Timeout, not an auth failure: status 0 (no HTTP response), retryable
      // by the next sync pass. The 401→renew→retry logic below never sees it.
      throw new CloudSyncApiError(
        0,
        `Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${
          options.method ?? 'GET'
        } ${path}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const body = text ? safeParseJson(text) : null;

  if (!response.ok) {
    // 401 → ONE silent renewal, then ONE retry with the fresh token (the
    // caller never sees the 401 when renewal succeeds). Concurrent 401s share
    // a single in-flight renewal (single-flight in tokenRenewal), and a hard
    // renewal 401 fires the once-only re-auth signal there.
    if (
      response.status === 401 &&
      options.auth !== false &&
      !options.retriedAfterRenewal &&
      (await renewToken())
    ) {
      return request<T>(path, { ...options, retriedAfterRenewal: true });
    }
    throw new CloudSyncApiError(
      response.status,
      extractErrorMessage(body, response.status),
      body
    );
  }

  return body as T;
}

/**
 * `POST /auth/request-code` — begins the sign-in flow by emailing an 8-digit
 * login code to the address. The backend always responds 202 (even for unknown
 * addresses) to avoid account enumeration, so this never rejects on "no account".
 */
export async function requestLoginCode(input: {
  email: string;
  displayName?: string;
}): Promise<void> {
  await request<unknown>('/auth/request-code', {
    method: 'POST',
    auth: false,
    body: { email: input.email, display_name: input.displayName ?? null },
  });
}

/**
 * `POST /auth/verify` — submits the 8-digit code. On success returns the JWT and
 * the resolved account (creating the user server-side if needed). The response
 * is parsed with the same shape parser `POST /auth/renew` uses (identical JSON).
 */
export async function verifyLoginCode(input: {
  email: string;
  code: string;
}): Promise<{ token: string; account: CloudAccount }> {
  const result = await request<CloudVerifyResponse>('/auth/verify', {
    method: 'POST',
    auth: false,
    body: { email: input.email, code: input.code },
  });

  return parseAuthResponse(result);
}

/**
 * `POST /realtime/ticket` — exchanges the access token for a short-lived
 * (60 s TTL server-side), single-use realtime ticket bound to the project.
 * The ticket travels to the WebSocket handshake as a `Sec-WebSocket-Protocol`
 * entry, never in the URL. A 401 here takes the exact same renew-then-retry
 * (and, on hard failure, once-only re-auth signal) path as any other API call.
 */
export async function requestRealtimeTicket(
  projectId: string
): Promise<string> {
  const result = await request<{
    ticket?: unknown;
    expiresAt?: unknown;
  }>('/realtime/ticket', {
    method: 'POST',
    body: { projectId },
  });
  if (typeof result?.ticket !== 'string' || result.ticket.length === 0) {
    throw new CloudSyncApiError(0, 'Realtime ticket response was malformed.');
  }
  return result.ticket;
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

/**
 * `GET /projects/:projectId/snapshot` — one page of the project's current
 * entities (collections, links, tasks, notes, todos) including soft-deleted
 * rows, for reconciliation against local state. Requires project membership
 * (viewer+).
 *
 * Pagination (scale-sync-backend): without a `cursor` this returns page 1 of
 * every type plus an additive `nextCursor` map for types with more rows; WITH
 * a cursor only that type's array is populated (its next page). The cursor is
 * opaque — pass `nextCursor[type]` back verbatim. The server answers 400 for a
 * cursor it cannot decode (e.g. it restarted with different pagination state).
 */
export async function getProjectSnapshot(
  projectId: string,
  pagination?: SnapshotPaginationParams
): Promise<SnapshotResponse> {
  const params = new URLSearchParams();
  if (pagination?.cursor) params.set('cursor', pagination.cursor);
  const pageSize = pagination?.pageSize;
  if (pageSize !== undefined && pageSize !== null && pageSize !== '') {
    params.set('pageSize', String(pageSize));
  }
  const query = params.toString();
  return request<SnapshotResponse>(
    `/projects/${projectId}/snapshot${query ? `?${query}` : ''}`
  );
}

const SNAPSHOT_ENTITY_TYPES: readonly SnapshotEntityTypeName[] = [
  'collections',
  'links',
  'tasks',
  'notes',
  'todos',
];

/**
 * Hard cap on pages fetched per entity type. A compliant server terminates
 * pagination (each cursor advances the keyset), so hitting this many pages for
 * one type means a pathological/looping server — abort instead of spinning.
 */
export const SNAPSHOT_MAX_PAGES_PER_TYPE = 100;

/** Read one type's row array from a snapshot response. */
function snapshotRows(
  response: SnapshotResponse,
  type: SnapshotEntityTypeName
): SnapshotCollection[] | SnapshotLink[] | SnapshotJsonEntity[] {
  if (type === 'collections') return response.collections;
  if (type === 'links') return response.links;
  if (type === 'tasks') return response.tasks;
  if (type === 'notes') return response.notes;
  return response.todos;
}

/** Append one type's rows onto the merged snapshot's array for that type. */
function appendRows(
  merged: SnapshotResponse,
  type: SnapshotEntityTypeName,
  rows: SnapshotCollection[] | SnapshotLink[] | SnapshotJsonEntity[]
): void {
  if (type === 'collections') {
    merged.collections.push(...(rows as SnapshotCollection[]));
  } else if (type === 'links') {
    merged.links.push(...(rows as SnapshotLink[]));
  } else if (type === 'tasks') {
    merged.tasks.push(...(rows as SnapshotJsonEntity[]));
  } else if (type === 'notes') {
    merged.notes.push(...(rows as SnapshotJsonEntity[]));
  } else {
    merged.todos.push(...(rows as SnapshotJsonEntity[]));
  }
}

/**
 * Fetch every page of the project snapshot and return ONE merged response with
 * the exact shape a single unbounded fetch used to produce (no `nextCursor`).
 *
 * Iteration (scale-sync-backend): page 1 is requested cursor-less — the same
 * request the old backend answered — then each type's `nextCursor` is followed
 * sequentially (deterministic, one request per page) until that type runs out.
 * Keyset ordering is preserved by concatenating pages in cursor order.
 *
 * Backward compatibility: a server that never returns `nextCursor` (old
 * backend, or every type fits the page cap) yields exactly one request and the
 * response passes through unchanged.
 *
 * Resilience: a 400 on a cursor request means the server rejected the cursor
 * (restart with different pagination state — keyset pagination tolerates a
 * changed page cap, so the worst case is re-fetching page 1). We restart the
 * whole fetch cursor-less ONCE; a second cursor failure surfaces the error.
 */
export async function getProjectSnapshotAllPages(
  projectId: string,
  opts: { pageSize?: number; _allowCursorFallback?: boolean } = {}
): Promise<SnapshotResponse> {
  // One cursor-rejection retry is allowed; the retried pass must surface
  // further 400s instead of looping.
  const allowCursorFallback = opts._allowCursorFallback !== false;
  const first = await getProjectSnapshot(
    projectId,
    opts.pageSize === undefined ? undefined : { pageSize: opts.pageSize }
  );

  const merged: SnapshotResponse = {
    collections: [...first.collections],
    links: [...first.links],
    tasks: [...first.tasks],
    notes: [...first.notes],
    todos: [...first.todos],
  };
  const pageCount: Record<SnapshotEntityTypeName, number> = {
    collections: 1,
    links: 1,
    tasks: 1,
    notes: 1,
    todos: 1,
  };

  let pending: SnapshotNextCursors | undefined = first.nextCursor;
  while (pending) {
    const types = SNAPSHOT_ENTITY_TYPES.filter(
      (type) => typeof pending?.[type] === 'string' && pending[type]
    );
    if (types.length === 0) break;

    const next: SnapshotNextCursors = {};
    let anyNext = false;
    for (const type of types) {
      pageCount[type] += 1;
      if (pageCount[type] > SNAPSHOT_MAX_PAGES_PER_TYPE) {
        throw new CloudSyncApiError(
          0,
          `Snapshot pagination exceeded ${SNAPSHOT_MAX_PAGES_PER_TYPE} pages for ${type}; aborting`
        );
      }

      let page: SnapshotResponse;
      try {
        page = await getProjectSnapshot(projectId, {
          cursor: pending[type] as string,
        });
      } catch (error) {
        if (
          error instanceof CloudSyncApiError &&
          error.status === 400 &&
          allowCursorFallback
        ) {
          // Cursor rejected (server restarted / pagination state changed):
          // restart the entire fetch cursor-less, once, and rebuild from the
          // fresh page 1 so the merged snapshot stays self-consistent.
          return getProjectSnapshotAllPages(projectId, {
            ...opts,
            _allowCursorFallback: false,
          });
        }
        throw error;
      }

      appendRows(merged, type, snapshotRows(page, type));
      const typeNext = page.nextCursor?.[type];
      if (typeNext) {
        next[type] = typeNext;
        anyNext = true;
      }
    }
    pending = anyNext ? next : undefined;
  }

  return merged;
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
