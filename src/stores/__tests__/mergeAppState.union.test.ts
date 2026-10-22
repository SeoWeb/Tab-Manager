import { mergeAppState, mergeSnapshots } from '@/stores/mergeAppState';
import type { AppState } from '@/stores/types';

// Pure-function tests for the per-entity-type union merge (task 1.3):
// create/update/delete interleavings, nested project→collection→link unions,
// boot-vs-rehydrate modes, and the write-path snapshot merge.

// Timestamp helpers. `d` yields Date objects (what the zustand reviver
// produces on rehydrate); `iso` yields ISO strings (what the storage wrapper
// compares on the write path, where blobs are raw JSON).
const d = (ms: number) => new Date(ms);
const iso = (ms: number) => new Date(ms).toISOString();

const note = (
  id: string,
  content: string,
  updatedAtMs: number,
  extra: Record<string, unknown> = {}
) => ({
  id,
  title: `title-${id}`,
  content,
  color: '#ffffff',
  createdAt: d(0),
  updatedAt: d(updatedAtMs),
  isPinned: false,
  ...extra,
});

const link = (id: string, url: string, updatedAtMs: number) => ({
  id,
  url,
  title: `title-${id}`,
  createdAt: d(0),
  updatedAt: d(updatedAtMs),
});

const collection = (
  id: string,
  links: ReturnType<typeof link>[],
  updatedAtMs: number
) => ({
  id,
  name: `name-${id}`,
  links,
  createdAt: d(0),
  updatedAt: d(updatedAtMs),
});

const project = (
  id: string,
  collections: ReturnType<typeof collection>[],
  updatedAtMs: number
) => ({
  id,
  name: `name-${id}`,
  collections,
  createdAt: d(0),
  updatedAt: d(updatedAtMs),
});

const makeCurrentState = (overrides: Record<string, unknown> = {}): AppState =>
  ({
    activeProjectId: 'p1',
    activeView: 'projectDetail',
    isDarkMode: false,
    searchQuery: '',
    themeColor: '#3b82f6',
    isSidebarOpen: false,
    isSidebarLoaded: true,
    projects: [project('p1', [collection('c1', [], 100)], 100)],
    quickLinks: [],
    notes: [],
    todos: [],
    tasks: [],
    taskTemplates: [],
    pomodoroSessions: [],
    taskViewSettings: { mode: 'list' },
    taskStats: {},
    activeTaskId: null,
    activePomodoroSession: null,
    cloudSync: { enabled: false },
    _hasHydrated: true,
    _themeFromStorage: false,
    hasCompletedOnboarding: true,
    ...overrides,
  }) as unknown as AppState;

const idsOf = (list: Array<{ id: string }> | undefined): string[] =>
  (list ?? []).map((item) => item.id);

describe('mergeAppState cross-context rehydrate (union mode)', () => {
  it('keeps local-only, persisted-only, and shared entities (create interleaving)', () => {
    const current = makeCurrentState({
      notes: [note('n-local', 'made on newtab', 200)],
    });
    const merged = mergeAppState(
      { notes: [note('n-remote', 'made on popup', 150)] },
      current
    );

    expect(idsOf(merged.notes).sort()).toEqual(['n-local', 'n-remote']);
  });

  it('prefers the local copy when its updatedAt is newer (update interleaving)', () => {
    const current = makeCurrentState({
      notes: [note('n1', 'newtab edit', 300)],
    });
    const merged = mergeAppState(
      { notes: [note('n1', 'popup edit', 200)] },
      current
    );

    expect(merged.notes.find((n) => n.id === 'n1')?.content).toBe(
      'newtab edit'
    );
  });

  it('prefers the persisted copy when its updatedAt is newer', () => {
    const current = makeCurrentState({
      notes: [note('n1', 'stale newtab copy', 100)],
    });
    const merged = mergeAppState(
      { notes: [note('n1', 'fresh popup edit', 400)] },
      current
    );

    expect(merged.notes.find((n) => n.id === 'n1')?.content).toBe(
      'fresh popup edit'
    );
  });

  it('breaks updatedAt ties in favor of the persisted copy', () => {
    const current = makeCurrentState({
      notes: [note('n1', 'local tie copy', 250)],
    });
    const merged = mergeAppState(
      { notes: [note('n1', 'persisted tie copy', 250)] },
      current
    );

    expect(merged.notes.find((n) => n.id === 'n1')?.content).toBe(
      'persisted tie copy'
    );
  });

  it('compares string timestamps against Date objects (raw-JSON snapshots)', () => {
    const current = makeCurrentState({
      notes: [{ ...note('n1', 'date-object local', 500) }],
    });
    const merged = mergeAppState(
      {
        notes: [
          { ...note('n1', 'iso-string persisted', 400), updatedAt: iso(400) },
        ],
      },
      current
    );

    expect(merged.notes.find((n) => n.id === 'n1')?.content).toBe(
      'date-object local'
    );
  });

  it('resurrects an entity deleted locally when a stale snapshot still has it (accepted LWW gap)', () => {
    const current = makeCurrentState({
      notes: [note('n-kept', 'still here', 100)], // n-deleted was removed locally
    });
    const merged = mergeAppState(
      {
        notes: [
          note('n-kept', 'still here', 100),
          note('n-deleted', 'ghost', 50),
        ],
      },
      current
    );

    // Documented deletion-resurrection gap; no tombstones in this phase.
    expect(idsOf(merged.notes).sort()).toEqual(['n-deleted', 'n-kept']);
  });

  it('resolves todo collisions (no updatedAt field) in favor of the persisted copy', () => {
    const current = makeCurrentState({
      todos: [
        { id: 't1', text: 'local toggle', completed: true },
        { id: 't-local', text: 'local only', completed: false },
      ],
    });
    const merged = mergeAppState(
      {
        todos: [
          { id: 't1', text: 'persisted copy', completed: false },
          { id: 't-remote', text: 'remote only', completed: true },
        ],
      },
      current
    );

    expect(idsOf(merged.todos).sort()).toEqual(['t-local', 't-remote', 't1']);
    expect(merged.todos.find((t) => t.id === 't1')?.text).toBe(
      'persisted copy'
    );
  });

  describe('nested project → collection → link unions', () => {
    it('unions collections added by either side inside a shared project', () => {
      const current = makeCurrentState({
        projects: [
          project('p1', [collection('c-local', [], 200)], 200),
          project('p-mine', [], 100),
        ],
      });
      const merged = mergeAppState(
        { projects: [project('p1', [collection('c-remote', [], 150)], 150)] },
        current
      );

      const shared = merged.projects.find((p) => p.id === 'p1');
      expect(idsOf(shared?.collections).sort()).toEqual([
        'c-local',
        'c-remote',
      ]);
      expect(idsOf(merged.projects)).toEqual(['p1', 'p-mine']);
    });

    it('keeps a locally-added link when a newer persisted snapshot renamed the project', () => {
      const current = makeCurrentState({
        projects: [
          project(
            'p1',
            [collection('c1', [link('l-local', 'https://local', 300)], 100)],
            100
          ),
        ],
      });
      const merged = mergeAppState(
        {
          projects: [
            {
              ...project('p1', [collection('c1', [], 100)], 500),
              name: 'renamed-on-popup',
            },
          ],
        },
        current
      );

      const shared = merged.projects.find((p) => p.id === 'p1');
      // Persisted project is newer → its scalars win, but the local link survives.
      expect(shared?.name).toBe('renamed-on-popup');
      expect(idsOf(shared?.collections[0]?.links)).toEqual(['l-local']);
    });

    it('takes the newer link on collision and never drops either side’s link-only creates', () => {
      const current = makeCurrentState({
        projects: [
          project(
            'p1',
            [
              collection(
                'c1',
                [
                  link('l1', 'https://local-newer', 400),
                  link('l-only-local', 'https://only-local', 100),
                ],
                400
              ),
            ],
            400
          ),
        ],
      });
      const merged = mergeAppState(
        {
          projects: [
            project(
              'p1',
              [
                collection(
                  'c1',
                  [
                    link('l1', 'https://persisted-older', 200),
                    link('l-only-remote', 'https://only-remote', 100),
                  ],
                  200
                ),
              ],
              200
            ),
          ],
        },
        current
      );

      const links = merged.projects[0].collections[0].links;
      expect(idsOf(links).sort()).toEqual([
        'l-only-local',
        'l-only-remote',
        'l1',
      ]);
      expect(links.find((l) => l.id === 'l1')?.url).toBe('https://local-newer');
    });
  });
});

describe('mergeAppState first hydration (boot mode)', () => {
  it('replaces entity arrays wholesale so deleted default mock entities are not resurrected', () => {
    const current = makeCurrentState({
      _hasHydrated: false,
      projects: [project('default-mock', [], 100)],
      notes: [note('default-note', 'mock', 100)],
    });
    const merged = mergeAppState(
      { projects: [project('p1', [], 100)], notes: [] },
      current
    );

    expect(idsOf(merged.projects)).toEqual(['p1']);
    expect(merged.notes).toEqual([]);
  });

  it('falls back to current arrays when the snapshot lacks them', () => {
    const current = makeCurrentState({
      _hasHydrated: false,
      projects: [project('p1', [], 100)],
    });
    const merged = mergeAppState({ isDarkMode: true }, current);

    expect(idsOf(merged.projects)).toEqual(['p1']);
    expect(merged.isDarkMode).toBe(true);
  });
});

describe('mergeSnapshots (write-path merge in the storage wrapper)', () => {
  it('lets the incoming writer win scalar fields', () => {
    const merged = mergeSnapshots(
      { activeProjectId: 'p-old', isDarkMode: false, notes: [] },
      { activeProjectId: 'p-new', isDarkMode: true, notes: [] }
    );

    expect(merged.activeProjectId).toBe('p-new');
    expect(merged.isDarkMode).toBe(true);
  });

  it('unions entity lists with ties going to the stored copy', () => {
    const merged = mergeSnapshots(
      {
        notes: [
          note('n-stored-tie', 'stored tie', 250),
          note('n-stored-only', 'stored only', 100),
        ],
      },
      {
        notes: [
          note('n-stored-tie', 'incoming tie', 250),
          note('n-incoming-only', 'incoming only', 300),
        ],
      }
    );

    expect(idsOf(merged.notes as Array<{ id: string }>).sort()).toEqual([
      'n-incoming-only',
      'n-stored-only',
      'n-stored-tie',
    ]);
    expect(
      (merged.notes as Array<{ id: string; content: string }>).find(
        (n) => n.id === 'n-stored-tie'
      )?.content
    ).toBe('stored tie');
  });

  it('merges cloudSync cursors per-key MAX and unions pendingEdits', () => {
    const merged = mergeSnapshots(
      {
        cloudSync: {
          cursors: { projA: 10, projB: 5 },
          pendingEdits: { entity1: ['title'] },
        },
      },
      {
        cloudSync: {
          cursors: { projA: 7, projC: 12 },
          pendingEdits: { entity1: ['notes'], entity2: ['url'] },
        },
      }
    );

    const cloudSync = merged.cloudSync as {
      cursors: Record<string, number>;
      pendingEdits: Record<string, string[]>;
    };
    expect(cloudSync.cursors).toEqual({ projA: 10, projB: 5, projC: 12 });
    expect(cloudSync.pendingEdits).toEqual({
      entity1: ['notes'],
      entity2: ['url'],
    });
  });

  it('passes through non-object sides untouched', () => {
    expect(mergeSnapshots(null, { notes: [] })).toEqual({ notes: [] });
    expect(mergeSnapshots({ notes: [] }, null)).toEqual({ notes: [] });
    expect(mergeSnapshots(undefined, undefined)).toEqual({});
  });

  it('does not invent empty entity keys neither side had', () => {
    const merged = mergeSnapshots({ themeColor: '#fff' }, { isDarkMode: true });
    expect(Object.keys(merged).sort()).toEqual(['isDarkMode', 'themeColor']);
  });
});
