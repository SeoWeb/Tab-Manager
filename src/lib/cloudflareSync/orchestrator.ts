import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import * as client from './client';
import * as config from './config';
import * as authStorage from './authStorage';
import * as queue from './queue';
import { acquireSyncLock, releaseSyncLock } from './syncLock';
import {
  buildCollectionPatch,
  buildLinkPatch,
  buildNotePatch,
  buildTodoPatch,
  buildTaskPatch,
} from './entityPatches';
import { diffSnapshot } from './reconcile';
import { canEdit } from './roles';
import type {
  CloudAccount,
  CloudEntityType,
  CloudInvitation,
  CloudMember,
  CloudMutation,
  CloudOperation,
  CloudProject,
  CloudRole,
  CloudSyncChange,
  CloudSyncStatus,
  DirtyFields,
  SnapshotResponse,
} from './types';

/**
 * Orchestrates cloud sync against the Zustand store.
 *
 * The store holds the reactive `cloudSync` slice and thin setters; this module
 * owns the actual flow (read queue, call the API, apply changes, update status,
 * persist cursors). UI components and Phase 3 actions call these functions.
 */

function setCloudState(
  patch: Partial<{
    enabled: boolean;
    status: CloudSyncStatus;
    lastSyncedAt: string | null;
    lastReconciledAt: string | null;
    lastError: string | null;
    pendingMutationCount: number;
    pendingEdits: DirtyFields;
    account: CloudAccount | null;
    apiBaseUrl: string;
  }>
): void {
  useAppStore.getState().setCloudSyncState(patch);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Enqueue a mutation only when cloud sync is enabled AND the owning project is
 * cloud-enabled. This is the single guarded entry point Phase 3 entity actions
 * call; it keeps the cloud/local distinction out of every action. Returns whether
 * a mutation was actually enqueued. Failures (e.g. storage errors) are logged and
 * swallowed so a sync hiccup never blocks the optimistic local update.
 */
export async function enqueueCloudChange(input: {
  projectId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  patch: Record<string, unknown>;
  baseVersion?: number;
}): Promise<boolean> {
  const { cloudSync, projects } = useAppStore.getState();
  if (!cloudSync.enabled) return false;
  const project = projects.find((p) => p.id === input.projectId);
  if (!project?.cloudEnabled) return false;

  try {
    await enqueueCloudMutation({
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      patch: input.patch,
      ...(input.baseVersion !== undefined
        ? { baseVersion: input.baseVersion }
        : {}),
    });
    return true;
  } catch (error) {
    console.error('[cloud-sync] failed to enqueue mutation', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Patch builders (collection/link) live in `entityPatches.ts` alongside the
// note/todo/task builders so every entity type uses one centralized contract.
// ---------------------------------------------------------------------------

/**
 * Load persisted credentials, API URL, and queue length into the store so the UI
 * reflects state across sessions. Resets any transient status (e.g. a `syncing`
 * left over from a previous session that never finished).
 */
export async function initCloudSync(): Promise<void> {
  const [account, apiBaseUrl, queueLength] = await Promise.all([
    authStorage.getAccount(),
    config.getApiBaseUrl(),
    queue.getQueueLength(),
  ]);

  const enabled = !!account && !!apiBaseUrl;
  setCloudState({
    account,
    apiBaseUrl,
    enabled,
    pendingMutationCount: queueLength,
    pendingEdits: queue.pendingEditsFromQueue(await queue.getQueue()),
    status: enabled ? (isOnline() ? 'idle' : 'offline') : 'idle',
    lastError: null,
  });
}

/** Persist the API URL in both the store and chrome.storage.local. */
export async function setCloudApiBaseUrl(url: string): Promise<void> {
  await config.setApiBaseUrl(url);
  const trimmed = url.trim();
  const account = await authStorage.getAccount();
  setCloudState({ apiBaseUrl: trimmed, enabled: !!account && !!trimmed });
}

/**
 * Step 1 of the email sign-in flow. Persists the API URL, then asks the backend
 * to email an 8-digit login code to the address. The backend always responds
 * 202 (even for unknown addresses) to avoid account enumeration, so this never
 * rejects on "no account" — callers simply advance to the code-entry step.
 */
export async function requestLoginCode(input: {
  apiBaseUrl: string;
  email: string;
  displayName?: string;
}): Promise<void> {
  await config.setApiBaseUrl(input.apiBaseUrl);
  await client.requestLoginCode({
    email: input.email,
    displayName: input.displayName,
  });
}

/**
 * Step 2 of the email sign-in flow. Submits the 8-digit code; on success the
 * backend returns a JWT which we persist, and the account becomes "connected".
 */
export async function verifyAndConnect(input: {
  email: string;
  code: string;
}): Promise<CloudAccount> {
  const { token, account } = await client.verifyLoginCode({
    email: input.email,
    code: input.code,
  });

  await authStorage.setToken(token);
  await authStorage.setAccount(account);

  const apiBaseUrl = await config.getApiBaseUrl();

  setCloudState({
    account,
    apiBaseUrl,
    enabled: true,
    status: 'idle',
    lastError: null,
  });

  return account;
}

/** Verify the stored token still works (used by the settings panel). */
export async function verifyCloudAccount(): Promise<CloudAccount | null> {
  try {
    const { user } = await client.getCurrentUser();
    const account: CloudAccount = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    await authStorage.setAccount(account);
    setCloudState({ account, lastError: null });
    return account;
  } catch (error) {
    setCloudState({ lastError: errorMessage(error) });
    return null;
  }
}

/** Sign out and clear the local queue (it is meaningless without auth). */
export async function disconnectCloudAccount(): Promise<void> {
  await authStorage.clearAuth();
  await queue.clearQueue();
  // Clear per-project cursors so a different account starts fresh — otherwise
  // the next pull would resume from a stale cursor and miss changes.
  useAppStore.getState().clearProjectCursors();
  setCloudState({
    account: null,
    enabled: false,
    status: 'idle',
    pendingMutationCount: 0,
    pendingEdits: {},
    lastError: null,
    lastSyncedAt: null,
  });
}

/**
 * Enqueue a local mutation. Called by Phase 3 entity actions when cloud sync is
 * enabled. Fills in `clientMutationId`, `clientId`, and `createdAt`.
 */
export async function enqueueCloudMutation(
  mutation: Omit<CloudMutation, 'clientMutationId' | 'clientId' | 'createdAt'> &
    Partial<Pick<CloudMutation, 'clientMutationId' | 'baseVersion'>>
): Promise<void> {
  const clientId = await config.getClientId();
  const full: CloudMutation = {
    clientMutationId: mutation.clientMutationId ?? crypto.randomUUID(),
    clientId,
    createdAt: new Date().toISOString(),
    projectId: mutation.projectId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    patch: mutation.patch,
    ...(mutation.baseVersion !== undefined
      ? { baseVersion: mutation.baseVersion }
      : {}),
  };

  const next = await queue.enqueueMutation(full);
  setCloudState({
    pendingMutationCount: next.length,
    pendingEdits: queue.pendingEditsFromQueue(next),
  });
}

/**
 * Push queued mutations for a project and pull changes since the last cursor.
 * Applies remote changes to the store, clears acknowledged mutations, and updates
 * status. Safe to call from the manual sync button.
 */
export async function syncProjectNow(projectId: string): Promise<void> {
  const { cloudSync } = useAppStore.getState();

  if (!cloudSync.enabled) {
    setCloudState({ lastError: 'Cloud sync is not enabled.' });
    return;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return;
  }

  // Avoid racing the background service worker's sync: if it holds the advisory
  // lock, defer — it will push/pull this project's changes itself. (Same-owner
  // re-entry from syncAllCloudProjects is allowed.)
  if (!(await acquireSyncLock('popup'))) {
    return;
  }

  setCloudState({ status: 'syncing', lastError: null });

  try {
    const mutations = await queue.getQueueForProject(projectId);
    const lastCursor = cloudSync.cursors[projectId] ?? null;
    const response = await client.syncProject({
      projectId,
      lastCursor,
      mutations,
    });

    // Apply remote changes (skips our own echoes by client id).
    const clientId = await config.getClientId();
    const store = useAppStore.getState();
    store.mergeRemoteChanges(response.changes, clientId);

    // The server applies accepted mutations idempotently and reports the rest as
    // conflicts. Under last-write-wins a structurally-conflicted mutation (e.g.
    // an update of an entity that was deleted remotely) will not succeed on retry,
    // so we drop every pushed mutation — accepted or conflicted — to keep the
    // queue bounded and avoid re-reporting the same conflict on every sync.
    // Conflicts are surfaced via status + lastError; a resolution UI is a later
    // phase.
    const remaining = await queue.removeMutations(
      mutations.map((m) => m.clientMutationId)
    );
    setCloudState({ pendingEdits: queue.pendingEditsFromQueue(remaining) });

    store.setProjectCursor(projectId, response.cursor);

    // Best-effort: refresh the current user's role so client-side role gating
    // stays accurate even after an admin changes it elsewhere. Never blocks or
    // fails the sync — a stale role only affects which UI controls are offered.
    void refreshProjectRole(projectId);

    setCloudState({
      status: response.conflicts.length ? 'conflict' : 'synced',
      lastSyncedAt: nowIso(),
      pendingMutationCount: remaining.length,
      lastError: response.conflicts.length
        ? formatConflicts(projectId, response.conflicts)
        : null,
    });
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
  } finally {
    await releaseSyncLock('popup');
  }
}

/**
 * Sync every cloud-enabled project in turn. Used by the global "Sync now" button.
 *
 * Since Phase 3 the cloud/local distinction is explicit (`project.cloudEnabled`),
 * so we sync exactly those projects. Any project with stray queued mutations is
 * also included as a safety net (e.g. a project that was disconnected while
 * mutations were still pending).
 */
export async function syncAllCloudProjects(): Promise<void> {
  const state = useAppStore.getState();
  const cloudProjectIds = new Set(
    state.projects.filter((p) => p.cloudEnabled).map((p) => p.id)
  );
  const queuedProjectIds = new Set(
    (await queue.getQueue()).map((m) => m.projectId)
  );
  const targetProjectIds = [
    ...new Set([...cloudProjectIds, ...queuedProjectIds]),
  ];

  if (targetProjectIds.length === 0) {
    // Nothing is cloud-enabled yet.
    setCloudState({ status: 'idle', lastError: null });
    return;
  }

  for (const projectId of targetProjectIds) {
    // eslint-disable-next-line no-await-in-loop -- sequential sync keeps status coherent
    await syncProjectNow(projectId);
  }
}

// ---------------------------------------------------------------------------
// Reconciliation (full snapshot diff, last-write-wins repair)
//
// Reconcile fetches the server's *current* entity set (not the change log) and
// diffs it against local state, repairing divergences that the incremental
// cursor-based path can never self-heal (e.g. a missed create/delete that scrolled
// past the cursor). Pulls reuse `applyRemoteChanges`; pushes reuse the mutation
// queue. It MUST NOT advance `lastSyncedAt` — that timestamp is the incremental
// cursor's heartbeat and is used to detect sync staleness.
// ---------------------------------------------------------------------------

/**
 * Run a full reconciliation for a single cloud project. Guards on cloud-enabled +
 * online + the advisory sync lock, fetches the snapshot, runs `diffSnapshot`,
 * applies pulls via `applyRemoteChanges`, enqueues pushes via `enqueueCloudChange`
 * (role/queue gated), and records `lastReconciledAt`.
 */
export async function reconcileProject(projectId: string): Promise<void> {
  const state = useAppStore.getState();
  const { cloudSync } = state;
  if (!cloudSync.enabled) return;

  const project = state.projects.find((p) => p.id === projectId);
  if (!project?.cloudEnabled) return;

  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return;
  }

  // Avoid racing the incremental sync / background worker on the same lock owner.
  if (!(await acquireSyncLock('popup'))) return;

  setCloudState({ status: 'syncing', lastError: null });
  try {
    const server: SnapshotResponse = await client.getProjectSnapshot(projectId);
    const clientId = await config.getClientId();
    const role = project.cloudRole;
    const queued = await queue.getQueueForProject(projectId);
    const queuedIds = new Set(queued.map((m) => m.entityId));

    const diff = diffSnapshot({
      collections: project.collections,
      tasks: state.tasks.filter((t) => t.projectId === projectId),
      notes: state.notes.filter((n) => n.projectId === projectId),
      todos: state.todos.filter((t) => t.projectId === projectId),
      server,
      queuedEntityIds: queuedIds,
    });

    // Apply pulls (create/update/delete-locally) through the existing reducer so
    // nesting + field-level conflict detection are preserved. `mergeRemoteChanges`
    // reuses `applyRemoteChanges` and records any field-level conflicts into
    // `syncConflicts`, which the `SyncConflictsPanel` surfaces.
    const conflictsBefore = useAppStore.getState().syncConflicts.length;
    if (diff.pulls.length) {
      useAppStore.getState().mergeRemoteChanges(diff.pulls, clientId);
    }
    const hasConflicts =
      useAppStore.getState().syncConflicts.length > conflictsBefore;

    // Pushes (local-newer / local-only) are enqueued as normal mutations. Viewers
    // (role < editor) are pull-only and skip pushes (the server enforces this too).
    if (canEdit(role)) {
      for (const push of diff.pushes) {
        // eslint-disable-next-line no-await-in-loop -- low-volume enqueue
        await enqueueCloudChange({
          projectId,
          entityType: push.entityType,
          entityId: push.entityId,
          operation: push.operation,
          patch: push.patch,
          ...(push.baseVersion !== undefined
            ? { baseVersion: push.baseVersion }
            : {}),
        });
      }
    }

    // Reconcile advances only `lastReconciledAt`, never the incremental
    // `lastSyncedAt` cursor heartbeat. Conflicts (if any) are surfaced via the
    // existing `SyncConflictsPanel`, so the status reflects them.
    setCloudState({
      status: hasConflicts ? 'conflict' : 'synced',
      lastReconciledAt: nowIso(),
      lastError: hasConflicts
        ? `${useAppStore.getState().syncConflicts.length} reconcile conflict(s)`
        : null,
    });
  } catch (error) {
    setCloudState({
      status: isOnline() ? 'error' : 'offline',
      lastError: errorMessage(error),
    });
  } finally {
    await releaseSyncLock('popup');
  }
}

/**
 * Reconcile every cloud-enabled (or queued) project in turn. Mirrors
 * `syncAllCloudProjects` but runs the snapshot diff instead of the cursor pull.
 */
export async function reconcileAllCloudProjects(): Promise<void> {
  const state = useAppStore.getState();
  const cloudProjectIds = new Set(
    state.projects.filter((p) => p.cloudEnabled).map((p) => p.id)
  );
  const queuedProjectIds = new Set(
    (await queue.getQueue()).map((m) => m.projectId)
  );
  const targetProjectIds = [
    ...new Set([...cloudProjectIds, ...queuedProjectIds]),
  ];

  if (targetProjectIds.length === 0) {
    setCloudState({ status: 'idle', lastError: null });
    return;
  }

  for (const projectId of targetProjectIds) {
    // eslint-disable-next-line no-await-in-loop -- sequential reconcile keeps status coherent
    await reconcileProject(projectId);
  }
}

// ---------------------------------------------------------------------------
// Cloud project lifecycle
//
// Project ids are server-authoritative: the Worker generates them via
// POST /projects and rejects project *create* mutations on the sync endpoint.
// So creating a cloud project always round-trips through POST /projects first,
// and the returned id becomes the local project id. Entity ids (collection/
// link/...) stay client-authoritative and are pushed via the sync endpoint.
// ---------------------------------------------------------------------------

/**
 * Create a brand-new cloud project. Creates the server project first (to obtain
 * the canonical id), then adds it locally with that id and `cloudEnabled`. No
 * Chrome bookmark folder is created — a cloud project's source of truth is the
 * Worker, not the bookmark tree.
 */
export async function addCloudProject(
  projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>
): Promise<Project | null> {
  const { cloudSync } = useAppStore.getState();
  if (!cloudSync.enabled) {
    setCloudState({
      lastError: 'Connect cloud sync before creating a cloud project.',
    });
    return null;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return null;
  }

  setCloudState({ status: 'syncing', lastError: null });
  try {
    const serverProject = await client.createProject({
      name: projectData.name,
      description: projectData.description ?? null,
      color: projectData.color ?? null,
      icon: projectData.icon ?? null,
    });

    useAppStore.getState().addProject(
      {
        name: serverProject.name,
        description: serverProject.description ?? '',
        color: serverProject.color ?? '#CCCCCC',
        icon: serverProject.icon ?? '',
      },
      {
        id: serverProject.id,
        cloudEnabled: true,
        cloudRole: 'owner',
        skipBookmarkCreation: true,
      }
    );

    setCloudState({
      status: 'synced',
      lastSyncedAt: nowIso(),
      lastError: null,
    });

    const created = useAppStore
      .getState()
      .projects.find((p) => p.id === serverProject.id);
    return created ?? null;
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
    return null;
  }
}

/**
 * Give an existing local project a server-side counterpart. Creates the server
 * project, re-keys the local project to the server id, then enqueues create
 * mutations for every existing collection and link so the server catches up to
 * the local state on the next sync.
 */
export async function convertProjectToCloud(
  localProjectId: string
): Promise<void> {
  const { cloudSync, projects } = useAppStore.getState();
  const project = projects.find((p) => p.id === localProjectId);
  if (!project) {
    setCloudState({ lastError: 'Project not found.' });
    return;
  }
  if (project.cloudEnabled) return; // already cloud-enabled
  if (!cloudSync.enabled) {
    setCloudState({
      lastError: 'Connect cloud sync before converting a project.',
    });
    return;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return;
  }

  setCloudState({ status: 'syncing', lastError: null });
  try {
    const serverProject = await client.createProject({
      name: project.name,
      description: project.description ?? null,
      color: project.color ?? null,
      icon: project.icon ?? null,
    });

    // Re-key the local project (and active selection) to the server id.
    useAppStore
      .getState()
      .convertProjectToCloudState(localProjectId, serverProject.id);
    // The converting user is the owner of the freshly created server project.
    useAppStore.getState().setProjectCloudRole(serverProject.id, 'owner');

    // Enqueue creates for existing collections/links so the server mirrors local
    // state. Entity ids are unchanged (client-authoritative); only the project id
    // is new.
    for (const collection of project.collections) {
      // eslint-disable-next-line no-await-in-loop -- ordered, low-volume
      await enqueueCloudMutation({
        projectId: serverProject.id,
        entityType: 'collection',
        entityId: collection.id,
        operation: 'create',
        patch: buildCollectionPatch(collection),
      });
      for (const link of collection.links) {
        // eslint-disable-next-line no-await-in-loop
        await enqueueCloudMutation({
          projectId: serverProject.id,
          entityType: 'link',
          entityId: link.id,
          operation: 'create',
          patch: buildLinkPatch(collection.id, link),
        });
      }
    }

    // Backfill the project's existing notes/todos/tasks too. These flat arrays
    // were just re-keyed to the server id by `convertProjectToCloudState`, so
    // filter by the new server id. Without this, items created before conversion
    // would never reach the server (only live creates enqueue). (Phase B3.)
    const storeState = useAppStore.getState();
    for (const note of storeState.notes.filter(
      (n) => n.projectId === serverProject.id
    )) {
      // eslint-disable-next-line no-await-in-loop -- ordered, low-volume
      await enqueueCloudMutation({
        projectId: serverProject.id,
        entityType: 'note',
        entityId: note.id,
        operation: 'create',
        patch: buildNotePatch(note),
      });
    }
    for (const todo of storeState.todos.filter(
      (t) => t.projectId === serverProject.id
    )) {
      // eslint-disable-next-line no-await-in-loop -- ordered, low-volume
      await enqueueCloudMutation({
        projectId: serverProject.id,
        entityType: 'todo',
        entityId: todo.id,
        operation: 'create',
        patch: buildTodoPatch(todo),
      });
    }
    for (const task of storeState.tasks.filter(
      (t) => t.projectId === serverProject.id
    )) {
      // eslint-disable-next-line no-await-in-loop -- ordered, low-volume
      await enqueueCloudMutation({
        projectId: serverProject.id,
        entityType: 'task',
        entityId: task.id,
        operation: 'create',
        patch: buildTaskPatch(task),
      });
    }

    setCloudState({
      status: 'synced',
      lastSyncedAt: nowIso(),
      lastError: null,
    });

    // Push the backfill immediately so the project shows as synced right away.
    await syncProjectNow(serverProject.id);
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
  }
}

/**
 * Stop syncing a project. Clears the local flag, drops any queued mutations for
 * it, and forgets its cursor. The server-side project is left intact so the user
 * can re-convert/re-join later; a destructive remote delete is intentionally not
 * performed here.
 */
export async function disconnectProjectFromCloud(
  projectId: string
): Promise<void> {
  const store = useAppStore.getState();
  store.setProjectCloudEnabled(projectId, false);
  store.clearProjectCursor(projectId);

  const queued = await queue.getQueueForProject(projectId);
  const remaining = await queue.removeMutations(
    queued.map((m) => m.clientMutationId)
  );
  setCloudState({ pendingMutationCount: remaining.length });
}

// ---------------------------------------------------------------------------
// Multi-user collaboration (Phase 4)
//
// Thin wrappers over the collaboration endpoints that also keep local state
// coherent: refreshing the current user's role, and materializing a joined
// project locally after an invite is accepted. Role/authorization truth lives
// on the Worker; these functions only fetch data and reflect it in the store.
// ---------------------------------------------------------------------------

/**
 * `GET /projects/:id` — refresh the current user's role on a cloud project into
 * the store. Swallows errors so callers (e.g. the sync loop) can invoke it
 * fire-and-forget. Returns the resolved role, or null if it could not be read.
 */
export async function refreshProjectRole(
  projectId: string
): Promise<CloudRole | null> {
  try {
    const { role } = await client.getProject(projectId);
    useAppStore.getState().setProjectCloudRole(projectId, role);
    return role;
  } catch (error) {
    console.error('[cloud-sync] failed to refresh project role', error);
    return null;
  }
}

/** `GET /projects/:id/members` — list members (requires admin). */
export async function fetchProjectMembers(
  projectId: string
): Promise<CloudMember[]> {
  return client.getProjectMembers(projectId);
}

/** `POST /projects/:id/invitations` — mint an invite code for this project. */
export async function createProjectInviteCode(
  projectId: string,
  input: { role?: CloudRole; email?: string | null; expiresInDays?: number }
): Promise<CloudInvitation> {
  return client.createProjectInvitation(projectId, input);
}

/** `PATCH /projects/:id/members/:userId` — change a member's role. */
export async function changeMemberRole(
  projectId: string,
  userId: string,
  role: CloudRole
): Promise<void> {
  await client.updateMemberRole(projectId, userId, role);
}

/** `DELETE /projects/:id/members/:userId` — remove a member (owner only). */
export async function removeProjectMemberById(
  projectId: string,
  userId: string
): Promise<void> {
  await client.removeProjectMember(projectId, userId);
}

/** `GET /projects/:id/activity` — recent change-log rows (read-only). */
export async function fetchProjectActivity(
  projectId: string,
  limit = 50
): Promise<CloudSyncChange[]> {
  return client.getProjectActivity(projectId, limit);
}

/**
 * `POST /invitations/:code/accept` then materialize the joined project locally.
 * Accepts the invite, fetches the project (to learn its data + our role), adds
 * it to the local store as cloud-enabled, then runs a sync to pull any existing
 * collections/links. Returns the local project, or null on failure.
 */
export async function acceptInviteCode(code: string): Promise<Project | null> {
  const { cloudSync } = useAppStore.getState();
  if (!cloudSync.enabled) {
    setCloudState({
      lastError: 'Connect cloud sync before joining a project.',
    });
    return null;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return null;
  }

  setCloudState({ status: 'syncing', lastError: null });
  try {
    const accepted = await client.acceptProjectInvitation(code.trim());
    const { project: serverProject, role } = await client.getProject(
      accepted.project_id
    );

    // If the project is already local (e.g. re-joining a disconnected one), just
    // re-enable it and refresh its role rather than creating a duplicate.
    const existing = useAppStore
      .getState()
      .projects.find((p) => p.id === serverProject.id);
    if (existing) {
      const store = useAppStore.getState();
      store.setProjectCloudEnabled(serverProject.id, true);
      store.setProjectCloudRole(serverProject.id, role);
    } else {
      useAppStore.getState().addProject(
        {
          name: serverProject.name,
          description: serverProject.description ?? '',
          color: serverProject.color ?? '#CCCCCC',
          icon: serverProject.icon ?? '',
        },
        {
          id: serverProject.id,
          cloudEnabled: true,
          cloudRole: role,
          skipBookmarkCreation: true,
        }
      );
    }

    // Pull the project's existing contents (collections/links authored by others).
    await syncProjectNow(serverProject.id);

    setCloudState({
      status: 'synced',
      lastSyncedAt: nowIso(),
      lastError: null,
    });

    return (
      useAppStore.getState().projects.find((p) => p.id === serverProject.id) ??
      null
    );
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
    return null;
  }
}

/**
 * `GET /projects` — discover cloud projects the signed-in user is already a member
 * of but that are not yet present on this device. Returns each remote project
 * carrying the user's role, minus any whose id already exists in the local store.
 *
 * This is the path a fresh client (e.g. the web frontend, or a second browser)
 * uses to pull in a project the user joined elsewhere: invite codes are
 * single-use so re-joining is impossible, and membership is global while the
 * local project list is per-device.
 */
export async function discoverCloudProjects(): Promise<
  (CloudProject & { role: CloudRole })[]
> {
  const { cloudSync } = useAppStore.getState();
  if (!cloudSync.enabled) {
    setCloudState({
      lastError: 'Connect cloud sync before discovering projects.',
    });
    return [];
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return [];
  }

  try {
    const remote = await client.listProjects();
    const localIds = new Set(useAppStore.getState().projects.map((p) => p.id));
    return remote.projects.filter(
      (p): p is CloudProject & { role: CloudRole } =>
        !!p.role && !localIds.has(p.id)
    );
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
    return [];
  }
}

/**
 * Materialize a discovered cloud project on this device. If a local project with
 * that id already exists (e.g. a previously-disconnected one), re-enable it and
 * refresh the role; otherwise add it locally as cloud-enabled. Then run a sync to
 * pull the project's existing collections/links. Mirrors the post-accept path in
 * `acceptInviteCode`. Returns the local project, or null on failure.
 */
export async function importCloudProject(
  project: CloudProject & { role: CloudRole }
): Promise<Project | null> {
  const { cloudSync } = useAppStore.getState();
  if (!cloudSync.enabled) {
    setCloudState({
      lastError: 'Connect cloud sync before importing a project.',
    });
    return null;
  }
  if (!isOnline()) {
    setCloudState({ status: 'offline' });
    return null;
  }

  setCloudState({ status: 'syncing', lastError: null });
  try {
    // If the project is already local, just re-enable it and refresh its role
    // rather than creating a duplicate.
    const existing = useAppStore
      .getState()
      .projects.find((p) => p.id === project.id);
    if (existing) {
      const store = useAppStore.getState();
      store.setProjectCloudEnabled(project.id, true);
      store.setProjectCloudRole(project.id, project.role);
    } else {
      useAppStore.getState().addProject(
        {
          name: project.name,
          description: project.description ?? '',
          color: project.color ?? '#CCCCCC',
          icon: project.icon ?? '',
        },
        {
          id: project.id,
          cloudEnabled: true,
          cloudRole: project.role,
          skipBookmarkCreation: true,
        }
      );
    }

    // Pull the project's existing contents (collections/links authored by others).
    await syncProjectNow(project.id);

    setCloudState({
      status: 'synced',
      lastSyncedAt: nowIso(),
      lastError: null,
    });

    return (
      useAppStore.getState().projects.find((p) => p.id === project.id) ?? null
    );
  } catch (error) {
    const status: CloudSyncStatus = isOnline() ? 'error' : 'offline';
    setCloudState({ status, lastError: errorMessage(error) });
    return null;
  }
}

function formatConflicts(
  projectId: string,
  conflicts: { entityType: string; entityId: string; message: string }[]
): string {
  const first = conflicts[0];
  return `${conflicts.length} sync conflict(s) for project ${projectId}: ${first.entityType} ${first.entityId} — ${first.message}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
