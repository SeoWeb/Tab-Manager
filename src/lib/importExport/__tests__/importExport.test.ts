// Tests for per-project export/import: round-trip, dedup, and merge semantics.
// The real store pulls in nanoid (ESM) which Jest can't transform, so we mock
// the store with a minimal in-memory getState/setState.

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

import {
  buildBundle,
  toJson,
  toCsv,
  toHtml,
} from '@/lib/importExport/exportProject';
import { applyImport } from '@/lib/importExport/importProject';
import type { ParsedBundle } from '@/lib/importExport/schema';
import type {
  Project,
  Collection,
  AdvancedTask,
  LegacyTask,
  Note,
} from '@/lib/importExport/types';

const now = new Date('2026-01-01T00:00:00Z');

function makeState() {
  const projectId = 'proj-1';
  const collectionId = 'col-1';
  const linkId = 'link-1';
  const taskId = 'task-1';
  const todoId = 'todo-1';
  const noteId = 'note-1';

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
            id: linkId,
            url: 'https://example.com',
            title: 'Example',
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

  const task: AdvancedTask = {
    id: taskId,
    title: 'Task A',
    priority: 'medium',
    status: 'todo',
    category: 'work',
    tags: [],
    subtasks: [],
    attachments: [],
    notes: '',
    progress: 0,
    comments: [],
    activities: [],
    isArchived: false,
    isFavorite: false,
    reminders: [],
    customFields: {},
    projectId,
    createdAt: now,
    updatedAt: now,
  };

  const todo: LegacyTask = {
    id: todoId,
    text: 'Buy milk',
    completed: false,
    category: 'home',
    projectId,
  };

  const note: Note = {
    id: noteId,
    title: 'Note A',
    content: 'hello',
    color: '#fff',
    isPinned: false,
    projectId,
    createdAt: now,
    updatedAt: now,
  };

  mockStoreData.projects = [project];
  mockStoreData.tasks = [task];
  mockStoreData.todos = [todo];
  mockStoreData.notes = [note];
  mockStoreData.activeProjectId = projectId;

  return { projectId, collectionId, linkId, taskId, todoId, noteId };
}

const selection = {
  collections: true,
  tasks: true,
  todos: true,
  notes: true,
};

function bundleFromCurrent(): ParsedBundle {
  const bundle = buildBundle('proj-1', selection)!;
  return {
    project: bundle.project,
    tasks: bundle.tasks,
    todos: bundle.todos,
    notes: bundle.notes,
  };
}

describe('exportProject', () => {
  beforeEach(() => makeState());

  it('builds a bundle scoped only to the project', () => {
    const bundle = buildBundle('proj-1', selection);
    expect(bundle).not.toBeNull();
    expect(bundle!.project.id).toBe('proj-1');
    expect(bundle!.project.collections).toHaveLength(1);
    expect(bundle!.project.collections[0].links).toHaveLength(1);
    expect(bundle!.tasks).toHaveLength(1);
    expect(bundle!.todos).toHaveLength(1);
    expect(bundle!.notes).toHaveLength(1);
  });

  it('serializes to JSON, CSV and HTML without throwing', () => {
    const bundle = buildBundle('proj-1', selection)!;
    expect(typeof toJson(bundle)).toBe('string');
    const csvFiles = toCsv(bundle, selection);
    expect(csvFiles.length).toBeGreaterThan(0);
    expect(typeof toHtml(bundle, selection)).toBe('string');
  });

  it('omits project collections when not selected', () => {
    const bundle = buildBundle('proj-1', {
      collections: false,
      tasks: true,
      todos: true,
      notes: true,
    })!;
    expect(bundle.project.collections).toHaveLength(0);
    expect(bundle.tasks).toHaveLength(1);
  });
});

describe('applyImport (merge-only, dedup by id + content)', () => {
  beforeEach(() => makeState());

  it('re-importing into the same project updates without adding or removing', () => {
    const bundle = bundleFromCurrent();
    const result = applyImport(bundle, {
      targetProjectId: null,
      createNew: false,
    });
    expect(mockStoreData.projects).toHaveLength(1);
    expect(mockStoreData.tasks).toHaveLength(1);
    expect(mockStoreData.todos).toHaveLength(1);
    expect(mockStoreData.notes).toHaveLength(1);
    expect(mockStoreData.projects[0].collections[0].links).toHaveLength(1);
    expect(result.totalUpdated).toBeGreaterThan(0);
    expect(result.totalAdded).toBe(0);
    expect(result.totalSkipped).toBe(0);
  });

  it('importing into a new project (distinct id) adds everything and creates it', () => {
    const bundle = bundleFromCurrent();
    bundle.project = { ...bundle.project, id: 'proj-new' };
    const before = mockStoreData.projects.length;
    const result = applyImport(bundle, {
      targetProjectId: null,
      createNew: true,
    });
    expect(mockStoreData.projects).toHaveLength(before + 1);
    expect(mockStoreData.projects.some((p) => p.id === 'proj-new')).toBe(true);
    expect(result.totalAdded).toBeGreaterThan(0);
    expect(result.totalUpdated).toBe(0);
  });

  it('importing "new" for an id that already exists merges instead of duplicating', () => {
    const bundle = bundleFromCurrent();
    const before = mockStoreData.projects.length;
    applyImport(bundle, { targetProjectId: null, createNew: true });
    expect(mockStoreData.projects).toHaveLength(before);
  });

  it('skips a link whose URL already exists in the target collection', () => {
    const target = makeState();
    // Target project already has a second link with the same URL.
    mockStoreData.projects = mockStoreData.projects.map((p) => ({
      ...p,
      collections: p.collections.map((c: Collection) => ({
        ...c,
        links: [
          ...c.links,
          {
            id: 'other-link',
            url: 'https://example.com',
            title: 'Dupe',
            createdAt: now,
            updatedAt: now,
          },
        ],
      })),
    }));
    // Imported link shares the collection id but has a different link id and
    // the same URL → must be skipped as a duplicate.
    const bundle: ParsedBundle = {
      project: {
        ...bundleFromCurrent().project,
        collections: [
          {
            id: 'col-1',
            name: 'Col A',
            links: [
              {
                id: 'link-x',
                url: 'https://example.com',
                title: 'Imported dupe',
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      tasks: [],
      todos: [],
      notes: [],
    };
    const result = applyImport(bundle, {
      targetProjectId: target.projectId,
      createNew: false,
    });
    expect(mockStoreData.projects[0].collections[0].links).toHaveLength(2);
    expect(result.links.skipped).toBe(1);
    expect(result.links.added).toBe(0);
  });

  it('preview matches apply counts', () => {
    const bundle = bundleFromCurrent();
    const options = { targetProjectId: null, createNew: true };
    const preview = applyImport(bundle, options);
    const applied = applyImport(bundle, options);
    expect(preview.totalAdded).toBe(applied.totalAdded);
    expect(preview.totalUpdated).toBe(applied.totalUpdated);
    expect(preview.totalSkipped).toBe(applied.totalSkipped);
  });
});
