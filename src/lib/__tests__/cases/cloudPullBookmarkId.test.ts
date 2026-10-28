import { diffSnapshot } from '../../cloudflareSync/reconcile';
import {
  applyRemoteChanges,
  type ApplyChangesInput,
} from '../../cloudflareSync/applyChanges';
import type { Collection, Link, Project } from '@/types';
import type { CloudSyncChange } from '../../cloudflareSync/types';
import type {
  SnapshotCollection,
  SnapshotLink,
  SnapshotResponse,
} from '../../cloudflareSync/types';

/**
 * Pulled link data must never write a bookmark id into local state: bookmark
 * ids are device-local, and a foreign device's id would make later deletes
 * target a nonexistent bookmark ("Can't find bookmark for id."). Covers both
 * the reconcile pull path (snapshot diff → applyRemoteChanges) and raw
 * change-log rows that still carry `bookmarkId` in their patch.
 */

const PROJECT_ID = 'proj-1';
const OLD = new Date('2026-01-01T00:00:00.000Z');
const NEWER = new Date('2026-02-01T00:00:00.000Z');

function localCollection(id: string, updatedAt: Date): Collection {
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
  };
}

function localLink(
  id: string,
  collectionId: string,
  updatedAt: Date,
  extra: Partial<Link> = {}
): Link {
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

function localProject(collections: Collection[]): Project {
  return {
    id: PROJECT_ID,
    name: 'Project',
    description: '',
    color: '#CCCCCC',
    icon: '',
    collections,
    createdAt: OLD,
    updatedAt: OLD,
    order: 0,
    bookmarkFolderId: null,
    cloudEnabled: true,
  };
}

function snapCollection(id: string, updatedAt: string): SnapshotCollection {
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
    // The bookmark id of whichever device last pushed this link.
    bookmark_id: 'bm-foreign',
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
  };
}

function stateWith(collections: Collection[]): ApplyChangesInput {
  return {
    projects: [localProject(collections)],
    notes: [],
    todos: [],
    tasks: [],
  };
}

/** Build a raw change-log row with sane defaults, overridden per test. */
function change(
  overrides: Partial<CloudSyncChange> &
    Pick<CloudSyncChange, 'operation' | 'entity_id' | 'patch'>
): CloudSyncChange {
  return {
    id: 1,
    change_id: 'ch-1',
    entity_type: 'link',
    project_id: PROJECT_ID,
    actor_id: 'u-other',
    base_version: null,
    client_mutation_id: null,
    client_id: 'ext-other',
    created_at: NEWER.toISOString(),
    ...overrides,
  };
}

describe('cloud pull does not write device-local bookmark ids', () => {
  it('a pulled update for an existing local link leaves its bookmark id unchanged', () => {
    const local = localCollection('c1', OLD);
    local.links.push(
      localLink('l1', 'c1', OLD, { bookmarkId: 'bm-local', title: 'mine' })
    );
    const state = stateWith([local]);

    const server: SnapshotResponse = {
      collections: [snapCollection('c1', NEWER.toISOString())],
      links: [snapLink('l1', 'c1', NEWER.toISOString())],
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
    });
    const linkPulls = diff.pulls.filter((p) => p.entity_type === 'link');
    expect(linkPulls).toHaveLength(1);
    expect(linkPulls[0].operation).toBe('update');
    // The pull patch itself must not carry the server's bookmark id.
    expect(linkPulls[0].patch).not.toHaveProperty('bookmarkId');

    const result = applyRemoteChanges(state, diff.pulls, 'ext-test');
    const pulled = result.projects[0].collections[0].links[0];
    expect(pulled.id).toBe('l1');
    // The local mirror id survives the pull…
    expect(pulled.bookmarkId).toBe('bm-local');
    // …while the remote field updates were still applied.
    expect(pulled.title).toBe('link-l1');
    expect(pulled.updatedAt.toISOString()).toBe(NEWER.toISOString());
  });

  it('a pulled create yields a link with a null bookmark id', () => {
    const state = stateWith([localCollection('c1', OLD)]);

    const server: SnapshotResponse = {
      collections: [snapCollection('c1', NEWER.toISOString())],
      links: [snapLink('l-new', 'c1', NEWER.toISOString())],
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
    });
    const linkPulls = diff.pulls.filter((p) => p.entity_type === 'link');
    expect(linkPulls).toHaveLength(1);
    expect(linkPulls[0].operation).toBe('create');
    expect(linkPulls[0].patch).not.toHaveProperty('bookmarkId');

    const result = applyRemoteChanges(state, diff.pulls, 'ext-test');
    const created = result.projects[0].collections[0].links[0];
    expect(created.id).toBe('l-new');
    expect(created.bookmarkId).toBeNull();
  });

  it('a raw change-log patch carrying bookmarkId is ignored on update and create', () => {
    // Update: the remote id must not overwrite the local mirror id.
    const local = localCollection('c1', OLD);
    local.links.push(localLink('l1', 'c1', OLD, { bookmarkId: 'bm-local' }));
    const state = stateWith([local]);

    const result = applyRemoteChanges(
      state,
      [
        change({
          operation: 'update',
          entity_id: 'l1',
          patch: { bookmarkId: 'bm-foreign', title: 'remote-title' },
        }),
      ],
      'ext-test'
    );
    const merged = result.projects[0].collections[0].links[0];
    expect(merged.bookmarkId).toBe('bm-local');
    expect(merged.title).toBe('remote-title');

    // Create: the link starts unmirrored regardless of the patch's id.
    const empty = stateWith([localCollection('c1', OLD)]);
    const created = applyRemoteChanges(
      empty,
      [
        change({
          operation: 'create',
          entity_id: 'l-new',
          patch: { collectionId: 'c1', bookmarkId: 'bm-foreign' },
        }),
      ],
      'ext-test'
    );
    expect(created.projects[0].collections[0].links[0].bookmarkId).toBeNull();
  });
});
