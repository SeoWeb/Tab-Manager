// Tasks 3.1/3.2 (fix-link-delete-stale-bookmark-id): imports must never plant
// bookmark ids into state. Bookmark ids are device-local — a backup exported
// on another device carries THAT device's ids, and importing them verbatim
// makes link deletion target bookmarks that do not exist here ("Can't find
// bookmark for id"). The import schema keeps `bookmarkId` so old and new
// backups still parse (backward compatible), but the mapping into state strips
// it so imported links start unmirrored and full bookmark sync re-mirrors.
//
// The real store pulls in nanoid (ESM) which Jest can't transform, so we mock
// the store with a minimal in-memory getState/setState (same as
// importExport.test.ts).

const mockStoreData: {
  projects: Project[];
  tasks: AdvancedTask[];
  todos: LegacyTask[];
  notes: Note[];
  activeProjectId: string | null;
} = {
  projects: [],
  tasks: [],
  todos: [],
  notes: [],
  activeProjectId: null,
};

jest.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => mockStoreData,
    setState: (patch: Record<string, unknown>) => {
      Object.assign(mockStoreData, patch);
    },
  },
}));

import { validateBundle } from '@/lib/importExport/schema';
import { applyImport } from '@/lib/importExport/importProject';
import { buildBundle, toJson } from '@/lib/importExport/exportProject';
import type {
  Project,
  AdvancedTask,
  LegacyTask,
  Note,
} from '@/lib/importExport/types';

const now = new Date('2026-01-01T00:00:00.000Z');

function makeState() {
  const projectId = 'proj-1';
  const collectionId = 'col-1';

  const project: Project = {
    id: projectId,
    name: 'My Project',
    description: 'desc',
    collections: [
      {
        id: collectionId,
        name: 'Col A',
        links: [
          {
            id: 'link-1',
            url: 'https://example.com/local',
            title: 'Local',
            bookmarkId: 'bm-local-1',
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  mockStoreData.projects = [project];
  mockStoreData.tasks = [];
  mockStoreData.todos = [];
  mockStoreData.notes = [];
  mockStoreData.activeProjectId = projectId;

  return { projectId, collectionId };
}

const selection = {
  collections: true,
  tasks: true,
  todos: true,
  notes: true,
};

/** A backup as exported on ANOTHER device: every link carries a foreign id. */
function foreignBundleJson() {
  return {
    version: 1 as const,
    exportedAt: '2026-01-02T00:00:00.000Z',
    project: {
      id: 'proj-1',
      name: 'My Project',
      collections: [
        {
          id: 'col-1',
          name: 'Col A',
          links: [
            {
              // Same id as the local link → import takes the update-by-id
              // path and must not overwrite the local bookmark id either.
              id: 'link-1',
              url: 'https://example.com/local',
              title: 'Local (edited elsewhere)',
              bookmarkId: 'bm-x',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            },
            {
              id: 'link-2',
              url: 'https://example.com/foreign',
              title: 'Foreign',
              bookmarkId: 'bm-y',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          // Not in the store yet → import adds the whole collection.
          id: 'col-2',
          name: 'Col B',
          links: [
            {
              id: 'link-3',
              url: 'https://example.com/new-collection',
              title: 'New collection link',
              bookmarkId: 'bm-z',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    tasks: [],
    todos: [],
    notes: [],
  };
}

describe('import strips foreign bookmarkId (device-local ids never import)', () => {
  beforeEach(() => makeState());

  it('a foreign bookmark id must NOT survive import (update, add, and new-collection paths)', () => {
    const parsed = validateBundle(foreignBundleJson());
    expect(parsed).not.toBeNull();

    applyImport(parsed!, { targetProjectId: null, createNew: false });

    const project = mockStoreData.projects.find((p) => p.id === 'proj-1')!;
    const colA = project.collections.find((c) => c.id === 'col-1')!;
    const colB = project.collections.find((c) => c.id === 'col-2')!;

    // Update-by-id: the foreign 'bm-x' (and the previous local id) is gone.
    expect(colA.links.find((l) => l.id === 'link-1')).toMatchObject({
      title: 'Local (edited elsewhere)',
      bookmarkId: null,
    });
    // Added into an existing collection: 'bm-y' must not survive.
    expect(colA.links.find((l) => l.id === 'link-2')).toMatchObject({
      url: 'https://example.com/foreign',
      bookmarkId: null,
    });
    // Link inside a newly added collection: 'bm-z' must not survive.
    expect(colB.links[0]).toMatchObject({
      id: 'link-3',
      bookmarkId: null,
    });
  });

  it('schema backward compat: an export containing bookmarkId still parses cleanly, but the resulting state has no bookmark id', () => {
    // Parse first: the schema keeps the field so old/new backups validate.
    const parsed = validateBundle(foreignBundleJson());
    expect(parsed).not.toBeNull();
    expect(parsed!.project.collections[0].links[0]).toMatchObject({
      id: 'link-1',
      bookmarkId: 'bm-x',
    });

    // Mapping into state strips it.
    applyImport(parsed!, { targetProjectId: null, createNew: false });

    const project = mockStoreData.projects.find((p) => p.id === 'proj-1')!;
    for (const collection of project.collections) {
      for (const link of collection.links) {
        expect(link.bookmarkId).toBeNull();
      }
    }
  });

  it('round trip: exports may still carry this device\u2019s ids, but importing them yields unmirrored links', () => {
    // The export path serializes live state, so this device's own bookmark
    // ids legitimately appear in the file.
    const bundle = buildBundle('proj-1', selection)!;
    const json = JSON.parse(toJson(bundle));
    expect(
      json.project.collections[0].links.find(
        (l: { id: string }) => l.id === 'link-1'
      ).bookmarkId
    ).toBe('bm-local-1');

    // Importing that file (even a self-backup) must not keep ids in state.
    const parsed = validateBundle(json);
    expect(parsed).not.toBeNull();
    applyImport(parsed!, { targetProjectId: null, createNew: false });

    const project = mockStoreData.projects.find((p) => p.id === 'proj-1')!;
    expect(project.collections[0].links[0]).toMatchObject({
      id: 'link-1',
      bookmarkId: null,
    });
  });
});
