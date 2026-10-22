/**
 * Write-path snapshot merge primitives (shared package).
 *
 * Extracted verbatim (logic-identical) from the extension's
 * `src/stores/mergeAppState.ts` so the shared storage wrapper
 * (`@tabspace/shared/stores/storage`) can merge on generation skew in BOTH
 * consumers. Everything here operates on plain JSON snapshot objects via
 * `unknown` + structural narrowing — deliberately no app-state type imports,
 * so the shared package stays decoupled from the app's `AppState` definition
 * (the app's state is structurally compatible).
 *
 * `mergeSnapshots` — used by the storage wrapper when a pending persist is
 * about to clobber a blob another context wrote. Scalars follow the writer
 * (incoming wins); entity lists are unioned exactly like the rehydrate path;
 * `cloudSync.cursors` merge per-key MAX (cursors are monotonic server
 * positions — a stale writer must never roll one back) and
 * `cloudSync.pendingEdits` union by key so queued mutations are never
 * dropped.
 *
 * Conflict model: per-entity-type union by `id` with last-write-wins on
 * `updatedAt` — ties go to the PERSISTED copy (the storage blob), matching
 * LWW. Entities without `updatedAt` (todos, quick links, templates) always
 * tie, so the persisted copy wins their collisions. Local-only entries are
 * NEVER dropped. Deletions can be resurrected by a stale snapshot in another
 * context — that is the accepted LWW gap from the change design (no
 * tombstones in this phase; cloud-synced deletes are protected by the
 * queued-entity guard in reconcile).
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

interface Identified {
  id: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Normalize any `updatedAt`-ish value (Date | ISO string | number) to epoch ms; NaN when absent/invalid. */
const updatedAtTime = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value).getTime();
  }
  return Number.NaN;
};

/**
 * True when the LOCAL copy should win an id collision: only when its
 * `updatedAt` is strictly newer than the persisted copy's. Ties and
 * missing/invalid timestamps resolve to the persisted copy (LWW tie-break).
 */
const localIsNewer = (local: unknown, persisted: unknown): boolean => {
  const localTime = updatedAtTime(
    (local as { updatedAt?: unknown } | null)?.updatedAt
  );
  const persistedTime = updatedAtTime(
    (persisted as { updatedAt?: unknown } | null)?.updatedAt
  );
  if (Number.isNaN(localTime)) return false;
  if (Number.isNaN(persistedTime)) return true;
  return localTime > persistedTime;
};

const hasId = (item: unknown): item is Identified =>
  isPlainObject(item) && typeof item.id === 'string';

/**
 * Union two flat entity lists by `id`. Local order is preserved; persisted
 * entries missing locally are appended in their own order. Nothing is ever
 * dropped from either side.
 */
export const unionById = (persisted: unknown, local: unknown): unknown[] => {
  const persistedItems = (
    Array.isArray(persisted) ? persisted : []
  ) as unknown[];
  const localItems = (Array.isArray(local) ? local : []) as unknown[];

  const persistedById = new Map<string, unknown>();
  persistedItems.forEach((item) => {
    if (hasId(item)) persistedById.set(item.id, item);
  });

  const merged: unknown[] = [];
  const seen = new Set<string>();

  localItems.forEach((item) => {
    if (!hasId(item)) {
      // Malformed entry: keep it rather than silently dropping data.
      merged.push(item);
      return;
    }
    seen.add(item.id);
    const persistedCopy = persistedById.get(item.id);
    merged.push(
      persistedCopy === undefined || localIsNewer(item, persistedCopy)
        ? item
        : persistedCopy
    );
  });

  persistedItems.forEach((item) => {
    if (hasId(item) && !seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  });

  return merged;
};

// ---------------------------------------------------------------------------
// Nested project → collection → link unions
// ---------------------------------------------------------------------------

/**
 * Union collections inside a project. The side that wins the project-level
 * comparison donates its collection objects on collision, but collections
 * that exist only on the other side are unioned in — so a collection added
 * by context B inside a project renamed by context A survives.
 */
const unionCollections = (persisted: unknown, local: unknown): unknown[] => {
  const persistedItems = (Array.isArray(persisted) ? persisted : []) as Array<
    Record<string, unknown>
  >;
  const localItems = (Array.isArray(local) ? local : []) as Array<
    Record<string, unknown>
  >;

  const persistedById = new Map<string, Record<string, unknown>>();
  persistedItems.forEach((item) => {
    if (hasId(item)) persistedById.set(item.id, item);
  });

  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  localItems.forEach((item) => {
    if (!hasId(item)) {
      merged.push(item);
      return;
    }
    seen.add(item.id);
    const persistedCopy = persistedById.get(item.id);
    if (persistedCopy === undefined) {
      merged.push(item);
      return;
    }
    // Newer collection object donates its scalar fields; the links list is
    // the union of both sides so a link added in either context survives.
    const winner = localIsNewer(item, persistedCopy) ? item : persistedCopy;
    merged.push({
      ...winner,
      links: unionById(persistedCopy.links, item.links),
    });
  });

  persistedItems.forEach((item) => {
    if (hasId(item) && !seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  });

  return merged;
};

/**
 * Union projects by `id` (newer `updatedAt` wins, ties → persisted). The
 * winning project's scalar fields are used, but its `collections` list is the
 * union of BOTH sides' collections (recursively unioning their links), so
 * nested entities from the losing side are never dropped.
 *
 * Entries are structurally-narrowed plain objects; the app-side caller casts
 * the result back to its typed project list.
 */
export const unionProjects = (
  persisted: unknown,
  local: unknown
): unknown[] => {
  const persistedItems = (Array.isArray(persisted) ? persisted : []) as Array<
    Record<string, unknown>
  >;
  const localItems = (Array.isArray(local) ? local : []) as Array<
    Record<string, unknown>
  >;

  const persistedById = new Map<string, Record<string, unknown>>();
  persistedItems.forEach((item) => {
    if (hasId(item)) persistedById.set(item.id, item);
  });

  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  localItems.forEach((localProject) => {
    if (!hasId(localProject)) {
      merged.push(localProject);
      return;
    }
    seen.add(localProject.id);
    const persistedProject = persistedById.get(localProject.id);
    if (persistedProject === undefined) {
      merged.push(localProject);
      return;
    }
    const winner = localIsNewer(localProject, persistedProject)
      ? localProject
      : persistedProject;
    merged.push({
      ...winner,
      collections: unionCollections(
        persistedProject.collections,
        localProject.collections
      ),
    });
  });

  persistedItems.forEach((item) => {
    if (hasId(item) && !seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  });

  return merged;
};

// ---------------------------------------------------------------------------
// Flat entity list keys present in persisted snapshots
// ---------------------------------------------------------------------------

const FLAT_ENTITY_KEYS = [
  'notes',
  'todos',
  'tasks',
  'taskTemplates',
  'quickLinks',
  'pomodoroSessions',
] as const;

// ---------------------------------------------------------------------------
// cloudSync merge (write path)
// ---------------------------------------------------------------------------

/**
 * Merge two cloudSync snapshots. Scalars follow the newer writer; cursors
 * merge per-key MAX (they are monotonic server change-log positions) and
 * pendingEdits union by entity id so queued mutations survive either order.
 */
const mergeCloudSyncState = (
  stored: unknown,
  incoming: unknown
): Record<string, unknown> => {
  if (!isPlainObject(stored))
    return isPlainObject(incoming) ? { ...incoming } : {};
  if (!isPlainObject(incoming)) return { ...stored };

  const maxCursors = (a: unknown, b: unknown): Record<string, number> => {
    const result: Record<string, number> = {};
    const apply = (source: unknown) => {
      if (!isPlainObject(source)) return;
      Object.entries(source).forEach(([key, value]) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          result[key] = Math.max(
            result[key] ?? Number.NEGATIVE_INFINITY,
            value
          );
        }
      });
    };
    apply(a);
    apply(b);
    return result;
  };

  return {
    ...stored,
    ...incoming,
    cursors: maxCursors(stored.cursors, incoming.cursors),
    pendingEdits: {
      ...(isPlainObject(stored.pendingEdits) ? stored.pendingEdits : {}),
      ...(isPlainObject(incoming.pendingEdits) ? incoming.pendingEdits : {}),
    },
  };
};

// ---------------------------------------------------------------------------
// Write-path snapshot merge (used by the storage wrapper on generation skew)
// ---------------------------------------------------------------------------

/**
 * Merge a pending snapshot (what this context is about to persist) with the
 * freshly stored blob (what another context just wrote). Scalars follow the
 * incoming writer; entity lists are unioned with LWW-by-`updatedAt`
 * (ties → the stored/persisted copy). Both inputs are plain JSON snapshot
 * objects (partialized state), not full AppState.
 */
export function mergeSnapshots(
  stored: unknown,
  incoming: unknown
): Record<string, unknown> {
  if (!isPlainObject(stored)) {
    return isPlainObject(incoming) ? { ...incoming } : {};
  }
  if (!isPlainObject(incoming)) return { ...stored };

  const merged: Record<string, unknown> = { ...stored, ...incoming };

  if ('projects' in stored || 'projects' in incoming) {
    merged.projects = unionProjects(stored.projects, incoming.projects);
  }
  FLAT_ENTITY_KEYS.forEach((key) => {
    if (key in stored || key in incoming) {
      merged[key] = unionById(stored[key], incoming[key]);
    }
  });

  if ('cloudSync' in stored || 'cloudSync' in incoming) {
    merged.cloudSync = mergeCloudSyncState(
      stored.cloudSync,
      incoming.cloudSync
    );
  }

  return merged;
}
