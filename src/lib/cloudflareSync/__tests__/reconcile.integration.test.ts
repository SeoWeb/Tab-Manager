import { diffSnapshot } from '../reconcile';
import { applyRemoteChanges, type ApplyChangesInput } from '../applyChanges';
import type { Collection } from '@/types';
import type { Note } from '@/stores/types';
import type { AdvancedTask } from '@/types/tasks';
import type {
  SnapshotCollection,
  SnapshotLink,
  SnapshotResponse,
} from '../types';

/**
 * Integration test for the full reconcile path: a divergent local store is
 * repaired against a server snapshot by running `diffSnapshot` and folding the
 * resulting pull changes through `applyRemoteChanges` (the same reducer the popup
 * uses). Exercises every pull classification in one realistic scenario.
 */

const PROJECT_ID = 'proj-1';

function localCollection(
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

function localLink(
  id: string,
  collectionId: string,
  updatedAt: Date,
  extra: Partial<Collection['links'][number]> = {}
): Collection['links'][number] {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `link-${id}`,
    favIconUrl: undefined,
    createdAt: updatedAt,
    updatedAt,
    tags: [],
    notes: undefined,
    order: 0,
    bookmarkId: null,
    ...extra,
  };
}

function localNote(id: string, updatedAt: Date): Note {
  return {
    id,
    title: `note-${id}`,
    content: `content-${id}`,
    color: '#ffffff',
    isPinned: false,
    createdAt: updatedAt,
    updatedAt,
    projectId: PROJECT_ID,
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
    version: 2,
    ...opts,
  };
}

function snapLink(
  id: string,
  collectionId: string,
  updatedAt: string
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
    version: 2,
  };
}

const OLD = new Date('2026-01-01T00:00:00.000Z');
const NEWER = new Date('2026-02-01T00:00:00.000Z');

describe('reconcile integration (snapshot diff → local repair)', () => {
  it('repairs a divergent local store against the server snapshot', () => {
    // Local store, as persisted:
    //  - c-stale: local copy of a collection the server later deleted
    //  - c-old:   present locally and on the server, but server is newer
    //  - link-x:  nested under c-old, server is newer
    //  - note-x:  present locally and on the server, but server is newer
    //  - c-missing: exists only on the server (create-locally)
    const cOld = localCollection('c-old', OLD);
    cOld.links.push(localLink('link-x', 'c-old', OLD));
    const cStale = localCollection('c-stale', OLD);
    const noteX = localNote('note-x', OLD);

    const state: ApplyChangesInput = {
      projects: [
        {
          id: PROJECT_ID,
          name: 'Project',
          description: '',
          color: '#CCCCCC',
          icon: '',
          collections: [cOld, cStale],
          createdAt: OLD,
          updatedAt: OLD,
          order: 0,
          bookmarkFolderId: null,
          cloudEnabled: true,
        },
      ],
      notes: [noteX],
      todos: [],
      tasks: [] as AdvancedTask[],
    };

    const server: SnapshotResponse = {
      collections: [
        snapCollection('c-old', NEWER.toISOString(), { name: 'coll-c-old-v2' }),
        snapCollection('c-missing', NEWER.toISOString(), {
          name: 'coll-c-missing',
        }),
        snapCollection('c-stale', NEWER.toISOString(), {
          deleted_at: NEWER.toISOString(),
        }),
      ],
      links: [snapLink('link-x', 'c-old', NEWER.toISOString())],
      tasks: [],
      notes: [
        {
          id: 'note-x',
          project_id: PROJECT_ID,
          collection_id: null,
          title: 'note-x',
          payload_json: JSON.stringify({
            content: 'content-note-x-v2',
          }),
          updated_at: NEWER.toISOString(),
          deleted_at: null,
          version: 2,
        },
      ],
      todos: [],
    };

    const diff = diffSnapshot({
      collections: state.projects[0].collections,
      tasks: [],
      notes: state.notes,
      todos: state.todos,
      server,
    });

    // 4 pulls: delete c-stale, update c-old, update link-x, update note-x, create
    // c-missing. (create-locally for c-missing + 3 updates + 1 delete.)
    expect(diff.pushes).toHaveLength(0);

    const result = applyRemoteChanges(state, diff.pulls, 'ext-test');

    const collections = result.projects[0].collections;
    // c-stale was deleted locally.
    expect(collections.map((c) => c.id)).not.toContain('c-stale');
    // c-missing was created locally.
    expect(collections.map((c) => c.id)).toContain('c-missing');
    // c-old was updated to the server's newer name, preserving its nested link.
    const repaired = collections.find((c) => c.id === 'c-old');
    expect(repaired?.name).toBe('coll-c-old-v2');
    expect(repaired?.links.map((l) => l.id)).toEqual(['link-x']);
    // link-x was updated to the server's newer updatedAt.
    expect(repaired?.links[0].updatedAt.toISOString()).toBe(
      NEWER.toISOString()
    );
    // note-x content was repaired.
    const repairedNote = result.notes.find((n) => n.id === 'note-x');
    expect(repairedNote?.content).toBe('content-note-x-v2');
  });

  it('does not resurrect a locally-deleted item that has a queued mutation', () => {
    const cLocal = localCollection('c-local', OLD);
    const state: ApplyChangesInput = {
      projects: [
        {
          id: PROJECT_ID,
          name: 'Project',
          description: '',
          color: '#CCCCCC',
          icon: '',
          collections: [cLocal],
          createdAt: OLD,
          updatedAt: OLD,
          order: 0,
          bookmarkFolderId: null,
          cloudEnabled: true,
        },
      ],
      notes: [],
      todos: [],
      tasks: [] as AdvancedTask[],
    };

    // Server still shows c-local as live (the local delete has not synced yet).
    const server: SnapshotResponse = {
      collections: [snapCollection('c-local', OLD.toISOString())],
      links: [],
      tasks: [],
      notes: [],
      todos: [],
    };

    const diff = diffSnapshot({
      collections: state.projects[0].collections,
      tasks: [],
      notes: [],
      todos: [],
      server,
      queuedEntityIds: ['c-local'],
    });

    // The queued local delete makes c-local locally authoritative: no pull.
    expect(diff.pulls).toHaveLength(0);
    const result = applyRemoteChanges(state, diff.pulls, 'ext-test');
    // The local delete stands; c-local remains locally (will sync via the queue).
    expect(result.projects[0].collections.map((c) => c.id)).toEqual([
      'c-local',
    ]);
  });
});
