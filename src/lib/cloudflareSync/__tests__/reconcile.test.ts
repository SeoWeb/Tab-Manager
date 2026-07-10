import { diffSnapshot } from '../reconcile';
import type { Collection, Link } from '@/types';
import type { Note } from '@/stores/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type {
  SnapshotCollection,
  SnapshotJsonEntity,
  SnapshotLink,
  SnapshotResponse,
} from '../types';

const PROJECT_ID = 'proj-1';

/** Build a local Collection. */
function collection(
  id: string,
  updatedAt: Date,
  extra: Partial<Collection> = {}
): Collection {
  return {
    id,
    name: `coll-${id}`,
    description: undefined,
    links: [],
    createdAt: updatedAt,
    updatedAt,
    color: '#fff',
    minimized: false,
    order: 0,
    bookmarkFolderId: null,
    ...extra,
  };
}

/** Build a local Link (nested under a collection). */
function link(
  id: string,
  collectionId: string,
  updatedAt: Date | undefined,
  extra: Partial<Link> = {}
): Link {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    favIconUrl: undefined,
    createdAt: updatedAt ?? new Date(0),
    updatedAt: updatedAt ?? new Date(0),
    tags: [],
    notes: undefined,
    order: 0,
    bookmarkId: null,
    ...extra,
  };
}

function note(id: string, updatedAt: Date, extra: Partial<Note> = {}): Note {
  return {
    id,
    title: `note-${id}`,
    content: `content-${id}`,
    color: '#ffffff',
    createdAt: updatedAt,
    updatedAt,
    isPinned: false,
    projectId: PROJECT_ID,
    ...extra,
  };
}

function task(
  id: string,
  updatedAt: Date,
  extra: Partial<AdvancedTask> = {}
): AdvancedTask {
  return {
    id,
    title: `task-${id}`,
    description: '',
    priority: 'medium',
    status: 'todo',
    category: 'general',
    tags: [],
    projectId: PROJECT_ID,
    subtasks: [],
    attachments: [],
    notes: '',
    createdAt: updatedAt,
    updatedAt,
    reminders: [],
    progress: 0,
    comments: [],
    activities: [],
    isArchived: false,
    isFavorite: false,
    customFields: {},
    ...extra,
  };
}

function todo(id: string, extra: Partial<LegacyTask> = {}): LegacyTask {
  return {
    id,
    text: `todo-${id}`,
    completed: false,
    projectId: PROJECT_ID,
    ...extra,
  };
}

function snapJson(
  id: string,
  updatedAt: string,
  payloadJson: string,
  opts: Partial<Omit<SnapshotJsonEntity, 'collection_id'>> = {}
): SnapshotJsonEntity {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: null,
    title: `title-${id}`,
    payload_json: payloadJson,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

function snapLink(
  id: string,
  collectionId: string | null,
  updatedAt: string,
  opts: Partial<Omit<SnapshotLink, 'collection_id'>> = {}
): SnapshotLink {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: collectionId,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    fav_icon_url: null,
    notes: null,
    tags_json: null,
    order_index: null,
    bookmark_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

function snapCollection(
  id: string,
  updatedAt: string,
  opts: Partial<Omit<SnapshotCollection, 'collection_id'>> = {}
): SnapshotCollection {
  return {
    id,
    project_id: PROJECT_ID,
    collection_id: null,
    name: `coll-${id}`,
    description: null,
    color: '#fff',
    minimized: 0,
    order_index: null,
    bookmark_folder_id: null,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    ...opts,
  };
}

function emptyServer(): SnapshotResponse {
  return { collections: [], links: [], tasks: [], notes: [], todos: [] };
}

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-01-02T00:00:00.000Z');
const T2 = new Date('2026-01-03T00:00:00.000Z');

describe('diffSnapshot — collections', () => {
  it('creates a missing local collection', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'collection',
      entity_id: 'c1',
      operation: 'create',
      client_id: null,
    });
    expect(result.pushes).toHaveLength(0);
  });

  it('updates a local collection when the server is newer', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
    expect(result.pushes).toHaveLength(0);
  });

  it('pushes a local collection when it is newer', () => {
    const server = emptyServer();
    server.collections = [snapCollection('c1', T0.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T2)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'collection',
      entityId: 'c1',
      operation: 'update',
    });
  });

  it('deletes a local collection when the server row is soft-deleted', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T2.toISOString(), { deleted_at: T2.toISOString() }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
    expect(result.pushes).toHaveLength(0);
  });

  it('pushes a local-only collection (no server row)', () => {
    const server = emptyServer();
    const result = diffSnapshot({
      collections: [collection('c1', T2)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('create');
  });
});

describe('diffSnapshot — links (nesting + legacy updatedAt backfill)', () => {
  it('creates a missing local link and keeps its parent collection', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1)],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'link',
      entity_id: 'l1',
      operation: 'create',
    });
    expect(result.pulls[0].patch).toMatchObject({ collectionId: 'c1' });
  });

  it('treats a legacy link missing updatedAt as its createdAt for LWW', () => {
    // Legacy link (no updatedAt) created at T0; server updated at T1 → server wins.
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T0.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T1.toISOString())];
    const result = diffSnapshot({
      collections: [
        collection('c1', T0, { links: [link('l1', 'c1', undefined)] }),
      ],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
    expect(result.pushes).toHaveLength(0);
  });

  it('updates a link when the server is newer', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T1)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
  });

  it('pushes a local-newer link', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T0.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T2)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('update');
  });

  it('deletes a local link when server marks it deleted', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [
      snapLink('l1', 'c1', T2.toISOString(), { deleted_at: T2.toISOString() }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T1)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
  });

  it('pushes a local-only link', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T2)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].operation).toBe('create');
  });
});

describe('diffSnapshot — notes', () => {
  it('creates / updates / deletes / pushes a note', () => {
    const server = emptyServer();
    server.notes = [
      snapJson(
        'n-missing',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-newer',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-older',
        T0.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-deleted',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}',
        {
          deleted_at: T2.toISOString(),
        }
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [
        note('n-newer', T1),
        note('n-older', T2),
        note('n-deleted', T1),
        note('n-local', T2),
      ],
      todos: [],
      server,
    });
    const create = result.pulls.filter((p) => p.operation === 'create');
    const update = result.pulls.filter((p) => p.operation === 'update');
    const del = result.pulls.filter((p) => p.operation === 'delete');
    expect(create.map((p) => p.entity_id)).toEqual(['n-missing']);
    expect(update.map((p) => p.entity_id)).toEqual(['n-newer']);
    expect(del.map((p) => p.entity_id)).toEqual(['n-deleted']);
    // n-older (local newer) + n-local (no server row) are pushes.
    expect(result.pushes).toHaveLength(2);
    expect(result.pushes.map((p) => p.entityId).sort()).toEqual([
      'n-local',
      'n-older',
    ]);
  });
});

describe('diffSnapshot — tasks', () => {
  it('creates a missing local task and pushes a local-only task', () => {
    const server = emptyServer();
    server.tasks = [
      snapJson(
        't-missing',
        T2.toISOString(),
        '{"title":"task-t-missing","priority":"medium","status":"todo","category":"general","tags":[],"notes":"","progress":0,"isArchived":false,"isFavorite":false}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [task('t-local', T2)],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'task',
      operation: 'create',
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'task',
      operation: 'create',
    });
  });

  it('updates a task when the server is newer', () => {
    const server = emptyServer();
    server.tasks = [
      snapJson(
        't1',
        T2.toISOString(),
        '{"title":"task-t1","priority":"medium","status":"todo","category":"general","tags":[],"notes":"","progress":0,"isArchived":false,"isFavorite":false}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [task('t1', T1)],
      notes: [],
      todos: [],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('update');
  });
});

describe('diffSnapshot — todos (no timestamp, content-based)', () => {
  it('creates a missing local todo and pushes a local-only todo', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td-missing',
        T2.toISOString(),
        '{"text":"todo-td-missing","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td-local')],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]).toMatchObject({
      entity_type: 'todo',
      operation: 'create',
    });
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0]).toMatchObject({
      entityType: 'todo',
      operation: 'create',
    });
  });

  it('pushes a locally-changed todo (content differs from server)', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"server-text","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1', { text: 'local-text' })],
      server,
    });
    // No pull (server present) but a push (keep local authoritative).
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].entityId).toBe('td1');
  });

  it('skips a todo whose content already matches the server', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"todo-td1","completed":false,"category":null}'
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1')],
      server,
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });

  it('deletes a local todo when the server marks it deleted', () => {
    const server = emptyServer();
    server.todos = [
      snapJson(
        'td1',
        T2.toISOString(),
        '{"text":"todo-td1","completed":false,"category":null}',
        {
          deleted_at: T2.toISOString(),
        }
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [],
      todos: [todo('td1')],
      server,
    });
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0].operation).toBe('delete');
  });
});

describe('diffSnapshot — queued-mutation skip (D9)', () => {
  it('does not resurrect a locally-deleted entity with a queued delete', () => {
    const server = emptyServer();
    // Snapshot still shows l1 live (the local delete has not reached the server).
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T2.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [] })], // link absent locally
      tasks: [],
      notes: [],
      todos: [],
      server,
      queuedEntityIds: ['l1'], // a delete mutation is queued for l1
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });

  it('does not push a locally-edited entity that already has a queued mutation', () => {
    const server = emptyServer();
    server.collections = [
      snapCollection('c1', T1.toISOString(), { version: 0 }),
    ];
    server.links = [snapLink('l1', 'c1', T0.toISOString())];
    const result = diffSnapshot({
      collections: [collection('c1', T1, { links: [link('l1', 'c1', T2)] })],
      tasks: [],
      notes: [],
      todos: [],
      server,
      queuedEntityIds: ['l1'],
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.pushes).toHaveLength(0);
  });
});
