import type { AppState } from './types';
import type { Project } from '@/types';
import {
  unionById,
  unionProjects,
} from '@tabspace/shared/stores/mergeSnapshots';

/**
 * Cross-context state merging (fix-cross-context-data-loss §1).
 *
 * `mergeAppState` below is the zustand persist `merge` hook: it runs on every
 * rehydrate. On the FIRST hydration (`_hasHydrated` still false) the persisted
 * snapshot wins wholesale (today's boot behavior — unioning against the
 * initial mock defaults would resurrect deleted default entities). On every
 * LATER rehydrate (the cross-context onChanged path) entity lists are UNIONED
 * by `id` instead of replaced wholesale, so a snapshot from another context
 * can never drop locally-created entities.
 *
 * The write-path snapshot merge (`mergeSnapshots`) and its union primitives
 * moved verbatim to `@tabspace/shared/stores/mergeSnapshots` so the shared
 * storage wrapper can merge on generation skew in BOTH consumers (extension
 * and web). `mergeSnapshots` is re-exported below so existing
 * `@/stores/mergeAppState` importers keep resolving. The shared primitives
 * return structurally-typed plain objects; casts at the call sites below
 * restore the app-level entity types (runtime-identical).
 */

export { mergeSnapshots } from '@tabspace/shared/stores/mergeSnapshots';

// ---------------------------------------------------------------------------
// Rehydrate merge (zustand persist `merge` hook)
// ---------------------------------------------------------------------------

/**
 * Merge persisted state into the current (default) state. Runs on every
 * rehydrate. `hasCompletedOnboarding` is governed solely by the explicit
 * persisted flag (first-run-onboarding): completing or skipping the wizard
 * sets it — nothing here infers it from the snapshot's shape.
 */
export const mergeAppState = (
  persistedState: unknown,
  currentState: AppState
): AppState => {
  if (!persistedState || typeof persistedState !== 'object') {
    console.warn('Invalid persisted state, using current state');
    return {
      ...currentState,
      _themeFromStorage: false, // Mark that no theme was loaded from storage
    };
  }

  try {
    const persistedStateTyped = persistedState as Partial<AppState>;
    const hasStoredTheme = 'isDarkMode' in persistedStateTyped;

    // Cross-context rehydrates (every rehydrate after the first) union entity
    // lists instead of replacing them wholesale, so a snapshot from another
    // context never drops locally-created entities. The FIRST hydration is
    // exempt: the "local" side is still the initial mock/default state, and
    // unioning would resurrect default entities the user deleted.
    const isCrossContextRehydrate = currentState?._hasHydrated === true;

    // Phase A per-project migration: assign the owning project to any
    // pre-existing notes/todos/tasks that predate `projectId`. This runs
    // in `merge` on every rehydrate (idempotent) — see the version note
    // above for why a version-gated `migrate` can't be relied on here.
    // Items with no resolvable project stay unscoped and surface only via
    // the global Tasks route as a safety net.
    const ownerProjectId =
      persistedStateTyped.activeProjectId ??
      persistedStateTyped.projects?.[0]?.id ??
      null;
    const stampProjectId = <T extends { projectId?: string }>(item: T): T => {
      if (item.projectId) return item;
      if (ownerProjectId == null) return item;
      return { ...item, projectId: ownerProjectId };
    };

    // Links predating the `updatedAt` field lack it; default to their
    // `createdAt` so last-write-wins comparison (reconcile) treats them as
    // authored at creation rather than as `undefined` (which always loses).
    const backfillLinkUpdatedAt = (project: Project): Project => ({
      ...project,
      collections: (project.collections || []).map((c) => ({
        ...c,
        links: (c.links || []).map((l) =>
          l.updatedAt ? l : { ...l, updatedAt: l.createdAt }
        ),
      })),
    });

    const persistedProjects = Array.isArray(persistedStateTyped.projects)
      ? persistedStateTyped.projects.map(backfillLinkUpdatedAt)
      : null;
    const persistedNotes = Array.isArray(persistedStateTyped.notes)
      ? persistedStateTyped.notes.map(stampProjectId)
      : null;
    const persistedTodos = Array.isArray(persistedStateTyped.todos)
      ? persistedStateTyped.todos.map(stampProjectId)
      : null;
    const persistedTasks = Array.isArray(persistedStateTyped.tasks)
      ? persistedStateTyped.tasks.map(stampProjectId)
      : null;

    const mergedState = {
      ...currentState,
      ...persistedState,
      // Mark whether theme was loaded from storage
      _themeFromStorage: hasStoredTheme,
      // Ensure critical properties are never undefined
      projects: persistedProjects
        ? isCrossContextRehydrate
          ? (unionProjects(
              persistedProjects,
              currentState.projects
            ) as Project[])
          : persistedProjects
        : currentState.projects,
      isDarkMode: hasStoredTheme
        ? (persistedStateTyped.isDarkMode ?? currentState.isDarkMode)
        : currentState.isDarkMode,
      activeView: persistedStateTyped.activeView || currentState.activeView,
      // Ensure modal states are properly initialized
      isAddProjectModalOpen:
        persistedStateTyped.isAddProjectModalOpen ??
        currentState.isAddProjectModalOpen,
      isAddCollectionModalOpen:
        persistedStateTyped.isAddCollectionModalOpen ??
        currentState.isAddCollectionModalOpen,
      isAddLinkModalOpen:
        persistedStateTyped.isAddLinkModalOpen ??
        currentState.isAddLinkModalOpen,
      isEditLinkModalOpen:
        persistedStateTyped.isEditLinkModalOpen ??
        currentState.isEditLinkModalOpen,
      // Ensure sidebar state is properly initialized
      isSidebarOpen:
        persistedStateTyped.isSidebarOpen ?? currentState.isSidebarOpen,
      isSidebarLoaded:
        persistedStateTyped.isSidebarLoaded ?? currentState.isSidebarLoaded,
      // Migrate notes from string to array format (and stamp projectId).
      // Cross-context rehydrates union by id; boot keeps persisted wholesale.
      notes: persistedNotes
        ? isCrossContextRehydrate
          ? (unionById(persistedNotes, currentState.notes) as AppState['notes'])
          : persistedNotes
        : currentState.notes,
      // Todos are preserved via the spread above; stamp projectId here
      todos: persistedTodos
        ? isCrossContextRehydrate
          ? (unionById(persistedTodos, currentState.todos) as AppState['todos'])
          : persistedTodos
        : currentState.todos,
      // Enhanced task management state merging (and stamp projectId)
      tasks: persistedTasks
        ? isCrossContextRehydrate
          ? (unionById(persistedTasks, currentState.tasks) as AppState['tasks'])
          : persistedTasks
        : currentState.tasks,
      taskTemplates: Array.isArray(persistedStateTyped.taskTemplates)
        ? isCrossContextRehydrate
          ? (unionById(
              persistedStateTyped.taskTemplates,
              currentState.taskTemplates
            ) as AppState['taskTemplates'])
          : persistedStateTyped.taskTemplates
        : currentState.taskTemplates,
      quickLinks: Array.isArray(persistedStateTyped.quickLinks)
        ? isCrossContextRehydrate
          ? (unionById(
              persistedStateTyped.quickLinks,
              currentState.quickLinks
            ) as AppState['quickLinks'])
          : persistedStateTyped.quickLinks
        : currentState.quickLinks,
      pomodoroSessions: Array.isArray(persistedStateTyped.pomodoroSessions)
        ? isCrossContextRehydrate
          ? (unionById(
              persistedStateTyped.pomodoroSessions,
              currentState.pomodoroSessions
            ) as AppState['pomodoroSessions'])
          : persistedStateTyped.pomodoroSessions
        : currentState.pomodoroSessions,
      taskViewSettings:
        persistedStateTyped.taskViewSettings || currentState.taskViewSettings,
      taskStats: persistedStateTyped.taskStats || currentState.taskStats,
      activeTaskId:
        persistedStateTyped.activeTaskId ?? currentState.activeTaskId,
      activePomodoroSession:
        persistedStateTyped.activePomodoroSession ??
        currentState.activePomodoroSession,
      cloudSync: persistedStateTyped.cloudSync ?? currentState.cloudSync,
      // Onboarding is governed SOLELY by the explicit persisted flag
      // (first-run-onboarding): completing or skipping the wizard sets it.
      // Nothing — and in particular not the presence of a `projects` array —
      // may infer completion here; the projects inference used to flip the
      // flag to true on the first store write, so fresh users could never
      // complete the wizard. Upgrading-user detection lives in the one-time
      // `tab-manager-onboarding-migration` marker (see appStore.ts), not in
      // the merge.
      hasCompletedOnboarding:
        persistedStateTyped.hasCompletedOnboarding ??
        currentState.hasCompletedOnboarding,
    };

    return mergedState;
  } catch (error) {
    console.error('Error merging state:', error);
    return {
      ...currentState,
      _themeFromStorage: false,
    };
  }
};
