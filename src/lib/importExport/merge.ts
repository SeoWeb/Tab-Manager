// Merge helpers for smart project import. Shared by computeImport.

import { useAppStore } from '@/stores/appStore';
import type {
  Collection,
  AdvancedTask,
  LegacyTask,
  Note,
  Project,
} from './types';
import type { ParsedBundle } from './schema';
import type { ImportOptions } from './importProject';

export interface Count {
  added: number;
  updated: number;
  skipped: number;
}

export interface ComputeResult {
  counts: {
    collections: Count;
    links: Count;
    tasks: Count;
    todos: Count;
    notes: Count;
  };
  projects: ReturnType<typeof useAppStore.getState>['projects'];
  tasks: AdvancedTask[];
  todos: LegacyTask[];
  notes: Note[];
  effectiveTargetId: string;
}

export function ensureDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function emptyCount(): Count {
  return { added: 0, updated: 0, skipped: 0 };
}

export function mergeCollections(
  targetCols: Collection[],
  importedCols: Collection[],
  c: { collections: Count; links: Count }
): Collection[] {
  const byId = new Map(targetCols.map((col) => [col.id, col]));
  const byName = new Map(
    targetCols.map((col) => [col.name.toLowerCase(), col])
  );
  const result: Collection[] = targetCols.map((col) => ({
    ...col,
    links: col.links.map((l) => ({ ...l })),
  }));

  for (const ic of importedCols) {
    const existing = byId.get(ic.id) ?? byName.get(ic.name.toLowerCase());
    if (existing) {
      c.collections.updated++;
      const linkById = new Map(existing.links.map((l) => [l.id, l]));
      const linkByUrl = new Map(existing.links.map((l) => [l.url, l]));
      const links = existing.links.map((l) => ({ ...l }));
      for (const il of ic.links) {
        if (linkById.has(il.id)) {
          c.links.updated++;
          const idx = links.findIndex((l) => l.id === il.id);
          links[idx] = {
            ...il,
            createdAt: ensureDate(il.createdAt),
            updatedAt: ensureDate(il.updatedAt),
          };
        } else if (linkByUrl.has(il.url)) {
          c.links.skipped++;
        } else {
          c.links.added++;
          links.push({
            ...il,
            createdAt: ensureDate(il.createdAt),
            updatedAt: ensureDate(il.updatedAt),
          });
        }
      }
      const idx = result.findIndex((r) => r.id === existing.id);
      result[idx] = {
        ...result[idx],
        name: ic.name,
        description: ic.description,
        color: ic.color,
        minimized: ic.minimized,
        order: ic.order,
        links,
      };
    } else {
      c.collections.added++;
      c.links.added += ic.links.length;
      result.push({
        ...ic,
        links: ic.links.map((l) => ({
          ...l,
          createdAt: ensureDate(l.createdAt),
          updatedAt: ensureDate(l.updatedAt),
        })),
      });
    }
  }
  return result;
}

export function mergeItems<T extends { id: string }>(
  all: T[],
  imported: T[],
  scopePredicate: (item: T) => boolean,
  contentKey: (item: T) => string,
  makeImported: (item: T) => T,
  counter: Count
): T[] {
  const scoped = all.filter(scopePredicate);
  const scopedById = new Map(scoped.map((t) => [t.id, t]));
  const scopedByContent = new Map(scoped.map((t) => [contentKey(t), true]));
  const updatedById = new Map<string, T>();
  const added: T[] = [];

  for (const it of imported) {
    if (scopedById.has(it.id)) {
      counter.updated++;
      updatedById.set(it.id, makeImported(it));
    } else if (scopedByContent.has(contentKey(it))) {
      counter.skipped++;
    } else {
      counter.added++;
      added.push(makeImported(it));
    }
  }

  const result = all.map((t) => updatedById.get(t.id) ?? t);
  return [...result, ...added];
}

export function computeImport(
  bundle: ParsedBundle,
  options: ImportOptions
): ComputeResult {
  const state = useAppStore.getState();
  const counts = {
    collections: emptyCount(),
    links: emptyCount(),
    tasks: emptyCount(),
    todos: emptyCount(),
    notes: emptyCount(),
  };

  // Resolve the effective target project.
  let effectiveTargetId = options.targetProjectId ?? bundle.project.id;
  let isNew = false;
  if (options.createNew) {
    const existing = state.projects.find((p) => p.id === bundle.project.id);
    if (existing) {
      effectiveTargetId = existing.id;
      isNew = false;
    } else {
      effectiveTargetId = bundle.project.id;
      isNew = true;
    }
  }

  if (isNew) {
    const newProject: Project = {
      ...bundle.project,
      id: bundle.project.id,
      cloudEnabled: false,
      cloudRole: undefined,
      createdAt: ensureDate(bundle.project.createdAt),
      updatedAt: new Date(),
      collections: bundle.project.collections.map((c) => ({
        ...c,
        links: c.links.map((l) => ({
          ...l,
          createdAt: ensureDate(l.createdAt),
          updatedAt: ensureDate(l.updatedAt),
        })),
      })),
    };
    const stampTask = (t: AdvancedTask): AdvancedTask => ({
      ...t,
      projectId: newProject.id,
      createdAt: ensureDate(t.createdAt),
      updatedAt: ensureDate(t.updatedAt),
    });
    const stampTodo = (t: LegacyTask): LegacyTask => ({
      ...t,
      projectId: newProject.id,
    });
    const stampNote = (n: Note): Note => ({
      ...n,
      projectId: newProject.id,
      createdAt: ensureDate(n.createdAt),
      updatedAt: ensureDate(n.updatedAt),
    });

    counts.collections.added = newProject.collections.length;
    counts.links.added = newProject.collections.reduce(
      (sum, c) => sum + c.links.length,
      0
    );
    counts.tasks.added = bundle.tasks.length;
    counts.todos.added = bundle.todos.length;
    counts.notes.added = bundle.notes.length;

    return {
      counts,
      projects: [...state.projects, newProject],
      tasks: [...state.tasks, ...bundle.tasks.map(stampTask)],
      todos: [...state.todos, ...bundle.todos.map(stampTodo)],
      notes: [...state.notes, ...bundle.notes.map(stampNote)],
      effectiveTargetId,
    };
  }

  // Merge into an existing project.
  const targetProject = state.projects.find((p) => p.id === effectiveTargetId);
  if (!targetProject) {
    // Fallback: create new if the chosen target disappeared.
    return computeImport(bundle, { targetProjectId: null, createNew: true });
  }

  const mergedCollections = mergeCollections(
    targetProject.collections,
    bundle.project.collections,
    counts
  );

  const newProjects = state.projects.map((p) =>
    p.id === effectiveTargetId
      ? { ...p, collections: mergedCollections, updatedAt: new Date() }
      : p
  );

  const scopeTask = (t: AdvancedTask) => t.projectId === effectiveTargetId;
  const scopeTodo = (t: LegacyTask) => t.projectId === effectiveTargetId;
  const scopeNote = (n: Note) => n.projectId === effectiveTargetId;

  const makeTask = (t: AdvancedTask): AdvancedTask => ({
    ...t,
    projectId: effectiveTargetId,
    createdAt: ensureDate(t.createdAt),
    updatedAt: ensureDate(t.updatedAt),
  });
  const makeTodo = (t: LegacyTask): LegacyTask => ({
    ...t,
    projectId: effectiveTargetId,
  });
  const makeNote = (n: Note): Note => ({
    ...n,
    projectId: effectiveTargetId,
    createdAt: ensureDate(n.createdAt),
    updatedAt: ensureDate(n.updatedAt),
  });

  const newTasks = mergeItems(
    state.tasks,
    bundle.tasks,
    scopeTask,
    (t) => (t.title || '').toLowerCase(),
    makeTask,
    counts.tasks
  );
  const newTodos = mergeItems(
    state.todos,
    bundle.todos,
    scopeTodo,
    (t) => (t.text || '').toLowerCase(),
    makeTodo,
    counts.todos
  );
  const newNotes = mergeItems(
    state.notes,
    bundle.notes,
    scopeNote,
    (n) =>
      `${(n.title || '').toLowerCase()}::${(n.content || '').toLowerCase()}`,
    makeNote,
    counts.notes
  );

  return {
    counts,
    projects: newProjects,
    tasks: newTasks,
    todos: newTodos,
    notes: newNotes,
    effectiveTargetId,
  };
}
