import { useAppStore } from '@/stores/appStore';
import * as queue from '@/lib/cloudflareSync/queue';
import type {
  CloudMutation,
  SyncConflictItem,
} from '@/lib/cloudflareSync/types';
import type { Collection, Project } from '@/types';
import type { AdvancedTask } from '@/types/tasks';
import type { Note } from '@/stores/types';

// `nanoid` v5 is ESM-only and cannot be parsed by jest's CJS transform when
// pulled in through the store's action modules; stub deterministically.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

// The store module starts a real persist hydrate on import; a `getItem` that
// never resolves keeps hydration from clobbering the per-test `setState` seeds.
jest.mock('@tabspace/shared/stores/storage', () => ({
  chromeStorageApi: {
    getItem: () => new Promise(() => {}),
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

/** In-memory chrome.storage.local mock (same contract as queue.test.ts). */
function installChromeStorage(
  initial: Record<string, unknown> = {}
): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in store) out[k] = store[k];
          setTimeout(() => cb(out), 2);
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, obj);
          setTimeout(() => cb(), 2);
        },
        remove: (keys: string | string[], cb: () => void) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keysArr) delete store[k];
          setTimeout(() => cb(), 2);
        },
      },
    },
  };
  return store;
}

const NOW = new Date('2026-10-21T00:00:00.000Z');

const link: Collection['links'][number] = {
  id: 'l1',
  url: 'https://local.example.com',
  title: 'Local link title',
  createdAt: NOW,
  updatedAt: NOW,
};

const collection: Collection = {
  id: 'c1',
  name: 'Local collection name',
  links: [link],
  createdAt: NOW,
  updatedAt: NOW,
};

const project: Project = {
  id: 'p1',
  name: 'Project One',
  collections: [collection],
  createdAt: NOW,
  updatedAt: NOW,
  cloudEnabled: true,
};

const note: Note = {
  id: 'n1',
  title: 'Local note title',
  content: 'local content',
  color: '#ffffff',
  isPinned: false,
  createdAt: NOW,
  updatedAt: NOW,
  projectId: 'p1',
};

const todo = {
  id: 'td1',
  text: 'Local todo text',
  completed: false,
  projectId: 'p1',
};

const task: AdvancedTask = {
  id: 'k1',
  title: 'Local task title',
  priority: 'medium',
  status: 'todo',
  category: 'general',
  tags: [],
  subtasks: [],
  attachments: [],
  notes: '',
  progress: 0,
  comments: [],
  activities: [],
  reminders: [],
  isArchived: false,
  isFavorite: false,
  customFields: {},
  createdAt: NOW,
  updatedAt: NOW,
  projectId: 'p1',
};

function conflictFor(
  entityType: SyncConflictItem['entityType'],
  entityId: string,
  field: string,
  localValue: unknown,
  remoteValue: unknown
): SyncConflictItem {
  return {
    id: `${entityId}:${field}:101`,
    entityType,
    entityId,
    field,
    localValue,
    remoteValue,
    projectId: 'p1',
    createdAt: NOW.toISOString(),
  };
}

/** Seed a conflicted update mutation in the queue (post-settle shape). */
async function seedConflictedMutation(
  entityType: CloudMutation['entityType'],
  entityId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await queue.enqueueMutation({
    clientMutationId: `mut-${entityId}`,
    projectId: 'p1',
    entityType,
    entityId,
    operation: 'update',
    patch,
    clientId: 'c1',
    createdAt: NOW.toISOString(),
    conflicted: true,
  });
}

/** Flush the dynamic-import + storage promise chains the actions fire. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

describe('conflict resolution coverage (fix-cross-context-data-loss 7.2)', () => {
  beforeEach(() => {
    installChromeStorage({ 'cloud-sync-mutation-queue': [] });
    useAppStore.setState({
      projects: [JSON.parse(JSON.stringify(project))],
      notes: [JSON.parse(JSON.stringify(note))],
      todos: [{ ...todo }],
      tasks: [{ ...task }],
      activeProjectId: 'p1',
      cloudSync: {
        ...useAppStore.getState().cloudSync,
        enabled: true,
        status: 'conflict',
        conflictedMutationCount: 0,
        pendingMutationCount: 0,
        pendingEdits: {},
      },
      syncConflicts: [],
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  // ---------------------------------------------------------------------------
  // Resolve-to-local ("keep mine"): enqueues a patch built from the local
  // value, mirroring what a fresh local edit of that type pushes.
  // ---------------------------------------------------------------------------

  it('resolve-to-local on a task enqueues a full task patch and releases the conflicted mutation', async () => {
    await seedConflictedMutation('task', 'k1', { title: 'Stale' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('task', 'k1', 'title', 'Local task title', 'Remote title'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('k1:title:101', 'local');
    await flush();

    const q = await queue.getQueue();
    expect(q).toHaveLength(1);
    const fresh = q[0];
    expect(fresh.conflicted).toBeUndefined();
    expect(fresh.entityType).toBe('task');
    expect(fresh.operation).toBe('update');
    expect(fresh.patch).toMatchObject({
      title: 'Local task title',
      payload: expect.objectContaining({ title: 'Local task title' }),
    });
    // The local edit is untouched in the store.
    expect(useAppStore.getState().tasks.find((t) => t.id === 'k1')?.title).toBe(
      'Local task title'
    );
    expect(useAppStore.getState().syncConflicts).toEqual([]);
  });

  it('resolve-to-local on a note enqueues the note patch shape', async () => {
    await seedConflictedMutation('note', 'n1', { title: 'Stale' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('note', 'n1', 'title', 'Local note title', 'Remote title'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('n1:title:101', 'local');
    await flush();

    const [fresh] = await queue.getQueue();
    expect(fresh.entityType).toBe('note');
    expect(fresh.patch).toEqual({
      title: 'Local note title',
      payload: { content: 'local content', color: '#ffffff', isPinned: false },
    });
  });

  it('resolve-to-local on a todo enqueues the todo patch shape', async () => {
    await seedConflictedMutation('todo', 'td1', { title: 'Stale' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('todo', 'td1', 'text', 'Local todo text', 'Remote todo'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('td1:text:101', 'local');
    await flush();

    const [fresh] = await queue.getQueue();
    expect(fresh.entityType).toBe('todo');
    expect(fresh.patch).toEqual({
      title: 'Local todo text',
      payload: { text: 'Local todo text', completed: false, category: null },
    });
  });

  it('resolve-to-local on a collection enqueues the collection patch shape', async () => {
    await seedConflictedMutation('collection', 'c1', { name: 'Stale' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor(
          'collection',
          'c1',
          'name',
          'Local collection name',
          'Remote name'
        ),
      ],
    });

    useAppStore.getState().resolveSyncConflict('c1:name:101', 'local');
    await flush();

    const [fresh] = await queue.getQueue();
    expect(fresh.entityType).toBe('collection');
    expect(fresh.patch).toEqual({
      name: 'Local collection name',
      description: null,
      color: null,
      minimized: false,
      order: 0,
    });
  });

  it('resolve-to-local on a link enqueues the link patch shape with its collection binding', async () => {
    await seedConflictedMutation('link', 'l1', { title: 'Stale' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('link', 'l1', 'title', 'Local link title', 'Remote title'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('l1:title:101', 'local');
    await flush();

    const [fresh] = await queue.getQueue();
    expect(fresh.entityType).toBe('link');
    expect(fresh.patch).toEqual({
      collectionId: 'c1',
      url: 'https://local.example.com',
      title: 'Local link title',
      favIconUrl: null,
      notes: null,
      tags: [],
      order: 0,
    });
  });

  // ---------------------------------------------------------------------------
  // Resolve-to-remote ("take theirs"): the remote value replaces the local
  // entity through the same store shape the reconcile apply writes.
  // ---------------------------------------------------------------------------

  it('resolve-to-remote applies the remote value for a collection and releases the conflicted mutation', async () => {
    await seedConflictedMutation('collection', 'c1', { name: 'Local' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor(
          'collection',
          'c1',
          'name',
          'Local collection name',
          'Remote name'
        ),
      ],
    });

    useAppStore.getState().resolveSyncConflict('c1:name:101', 'remote');
    await flush();

    const stored = useAppStore
      .getState()
      .projects.find((p) => p.id === 'p1')
      ?.collections.find((c) => c.id === 'c1');
    expect(stored?.name).toBe('Remote name');
    expect(useAppStore.getState().syncConflicts).toEqual([]);
    // The superseded local push is gone from the queue.
    expect(await queue.getConflictedCount()).toBe(0);
    expect(await queue.getQueue()).toEqual([]);
  });

  it('resolve-to-remote applies the remote value for a link (nested under its project)', async () => {
    await seedConflictedMutation('link', 'l1', { title: 'Local' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('link', 'l1', 'title', 'Local link title', 'Remote title'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('l1:title:101', 'remote');
    await flush();

    const stored = useAppStore
      .getState()
      .projects.find((p) => p.id === 'p1')
      ?.collections.find((c) => c.id === 'c1')
      ?.links.find((l) => l.id === 'l1');
    expect(stored?.title).toBe('Remote title');
    expect(await queue.getConflictedCount()).toBe(0);
  });

  it('resolve-to-remote applies the remote value for a todo', async () => {
    await seedConflictedMutation('todo', 'td1', { title: 'Local' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('todo', 'td1', 'text', 'Local todo text', 'Remote todo'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('td1:text:101', 'remote');
    await flush();

    expect(useAppStore.getState().todos.find((t) => t.id === 'td1')?.text).toBe(
      'Remote todo'
    );
    expect(await queue.getConflictedCount()).toBe(0);
  });

  it('releasing is keyed by entity: another entity’s conflicted mutation survives', async () => {
    await seedConflictedMutation('note', 'n1', { title: 'Stale n1' });
    await queue.enqueueMutation({
      clientMutationId: 'mut-other',
      projectId: 'p1',
      entityType: 'task',
      entityId: 'k1',
      operation: 'update',
      patch: { title: 'Stale k1' },
      clientId: 'c1',
      createdAt: NOW.toISOString(),
      conflicted: true,
    });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('note', 'n1', 'title', 'Local note title', 'Remote'),
      ],
    });

    useAppStore.getState().resolveSyncConflict('n1:title:101', 'remote');
    await flush();

    const q = await queue.getQueue();
    expect(q.map((m) => m.clientMutationId)).toEqual(['mut-other']);
    expect(q[0].conflicted).toBe(true);
  });

  it('dismissSyncConflict is the explicit discard: it releases the conflicted mutation', async () => {
    await seedConflictedMutation('note', 'n1', { title: 'Local note title' });
    useAppStore.setState({
      syncConflicts: [
        conflictFor('note', 'n1', 'title', 'Local note title', 'Remote'),
      ],
    });

    useAppStore.getState().dismissSyncConflict('n1:title:101');
    await flush();

    expect(useAppStore.getState().syncConflicts).toEqual([]);
    expect(await queue.getQueue()).toEqual([]);
    expect(useAppStore.getState().cloudSync.conflictedMutationCount).toBe(0);
  });
});

describe('end-to-end conflict flow (fix-cross-context-data-loss 7.3)', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = installChromeStorage({ 'cloud-sync-mutation-queue': [] });
    const localNote = JSON.parse(JSON.stringify(note)) as Note;
    // The queued edit below has already been applied optimistically to the
    // store — that is the local edit the conflict must protect.
    localNote.title = 'My local edit';
    useAppStore.setState({
      projects: [JSON.parse(JSON.stringify(project))],
      notes: [localNote],
      todos: [{ ...todo }],
      tasks: [{ ...task }],
      activeProjectId: 'p1',
      cloudSync: {
        ...useAppStore.getState().cloudSync,
        enabled: true,
        status: 'synced',
        conflictedMutationCount: 0,
        pendingMutationCount: 0,
        // The queued note edit is still un-pushed, so remote edits to the
        // same field must not silently overwrite it.
        pendingEdits: { n1: ['title'] },
      },
      syncConflicts: [],
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('conflict recorded → local edit still visible → resolution applies → mutation released and pushed', async () => {
    // 1. The user edits a note locally; the queued push is CAS-rejected.
    const queued: CloudMutation = {
      clientMutationId: 'mut-e2e',
      projectId: 'p1',
      entityType: 'note',
      entityId: 'n1',
      operation: 'update',
      patch: {
        title: 'My local edit',
        payload: {
          content: 'local content',
          color: '#ffffff',
          isPinned: false,
        },
      },
      clientId: 'c1',
      createdAt: NOW.toISOString(),
    };
    await queue.enqueueMutation(queued);
    const settlement = await queue.settleMutationOutcomes(
      [queued],
      [{ clientMutationId: 'mut-e2e', status: 'conflict' }]
    );
    expect(settlement.conflicted).toHaveLength(1);

    // 2. The same sync pulls the competing remote change: the conflict is
    //    recorded instead of dropping the local edit.
    useAppStore.getState().mergeRemoteChanges(
      [
        {
          id: 101,
          change_id: 'ch-101',
          project_id: 'p1',
          entity_type: 'note',
          entity_id: 'n1',
          operation: 'update',
          patch: { title: 'Remote title', payload: { content: 'remote' } },
          base_version: 2,
          client_mutation_id: null,
          client_id: 'other-client',
          actor_id: 'user-2',
          created_at: NOW.toISOString(),
        },
      ],
      'c1'
    );

    const conflicts = useAppStore.getState().syncConflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      entityType: 'note',
      entityId: 'n1',
      field: 'title',
      localValue: 'My local edit',
      remoteValue: 'Remote title',
    });
    // The local edit is still visible in the UI state.
    expect(useAppStore.getState().notes.find((n) => n.id === 'n1')?.title).toBe(
      'My local edit'
    );
    // And the conflicted mutation is still queued, flagged.
    expect((await queue.getQueue())[0].clientMutationId).toBe('mut-e2e');
    expect((await queue.getQueue())[0].conflicted).toBe(true);

    // 3. The user keeps their edit: a fresh push is enqueued and the
    //    conflicted entry is released.
    useAppStore.getState().resolveSyncConflict(conflicts[0].id, 'local');
    await flush();

    const afterResolve = await queue.getQueue();
    expect(afterResolve).toHaveLength(1);
    const fresh = afterResolve[0];
    expect(fresh.clientMutationId).not.toBe('mut-e2e');
    expect(fresh.conflicted).toBeUndefined();
    expect(fresh.operation).toBe('update');
    // The fresh push carries the current local value: the protected title plus
    // the remotely-merged content (only `title` was a pending local edit, so
    // the non-conflicting remote content merged in during the pull).
    expect(fresh.patch).toEqual({
      title: 'My local edit',
      payload: { content: 'remote', color: '#ffffff', isPinned: false },
    });
    expect(useAppStore.getState().notes.find((n) => n.id === 'n1')?.title).toBe(
      'My local edit'
    );
    expect(useAppStore.getState().cloudSync.conflictedMutationCount).toBe(0);

    // 4. The next sync pushes the fresh mutation and the server applies it:
    //    the queue drains — nothing was lost.
    const pushSettlement = await queue.settleMutationOutcomes(
      [fresh],
      [{ clientMutationId: fresh.clientMutationId, status: 'applied' }]
    );
    expect(pushSettlement.released).toHaveLength(1);
    expect(await queue.getQueue()).toEqual([]);
    expect(store['cloud-sync-mutation-queue']).toEqual([]);
  });
});
