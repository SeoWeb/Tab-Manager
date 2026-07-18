import type { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import * as client from '../client';
import { isOnline, nowIso, setCloudState, errorMessage } from './internal';
import { syncProjectNow } from './sync';
import type {
  CloudSyncStatus,
  CloudRole,
  CloudMember,
  CloudInvitation,
  CloudSyncChange,
  CloudProject,
} from '../types';

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
