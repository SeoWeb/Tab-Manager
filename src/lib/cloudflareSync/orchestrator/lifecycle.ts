import type { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import * as client from '../client';
import * as queue from '../queue';
import {
  buildCollectionPatch,
  buildLinkPatch,
  buildNotePatch,
  buildTodoPatch,
  buildTaskPatch,
} from '../entityPatches';
import { enqueueCloudMutation } from './enqueue';
import { syncProjectNow } from './sync';
import { isOnline, nowIso, setCloudState, errorMessage } from './internal';
import type { CloudSyncStatus } from '../types';

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
