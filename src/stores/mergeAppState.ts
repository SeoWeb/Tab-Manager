import type { AppState } from './types';
import type { Project } from '@/types';

/**
 * Merge persisted state into the current (default) state. Runs on every
 * rehydrate. Forces `hasCompletedOnboarding: true` when the persisted snapshot
 * already contains a `projects` array (existing/upgrading user skip).
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

    const mergedState = {
      ...currentState,
      ...persistedState,
      // Mark whether theme was loaded from storage
      _themeFromStorage: hasStoredTheme,
      // Ensure critical properties are never undefined
      projects: Array.isArray(persistedStateTyped.projects)
        ? persistedStateTyped.projects.map(backfillLinkUpdatedAt)
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
      // Migrate notes from string to array format (and stamp projectId)
      notes: Array.isArray(persistedStateTyped.notes)
        ? persistedStateTyped.notes.map(stampProjectId)
        : currentState.notes,
      // Todos are preserved via the spread above; stamp projectId here
      todos: Array.isArray(persistedStateTyped.todos)
        ? persistedStateTyped.todos.map(stampProjectId)
        : currentState.todos,
      // Enhanced task management state merging (and stamp projectId)
      tasks: Array.isArray(persistedStateTyped.tasks)
        ? persistedStateTyped.tasks.map(stampProjectId)
        : currentState.tasks,
      taskTemplates: Array.isArray(persistedStateTyped.taskTemplates)
        ? persistedStateTyped.taskTemplates
        : currentState.taskTemplates,
      taskViewSettings:
        persistedStateTyped.taskViewSettings || currentState.taskViewSettings,
      taskStats: persistedStateTyped.taskStats || currentState.taskStats,
      pomodoroSessions: Array.isArray(persistedStateTyped.pomodoroSessions)
        ? persistedStateTyped.pomodoroSessions
        : currentState.pomodoroSessions,
      activeTaskId:
        persistedStateTyped.activeTaskId ?? currentState.activeTaskId,
      activePomodoroSession:
        persistedStateTyped.activePomodoroSession ??
        currentState.activePomodoroSession,
      cloudSync: persistedStateTyped.cloudSync ?? currentState.cloudSync,
      // Skip onboarding for existing/upgrading users: if the persisted
      // snapshot already had projects, the user has prior state and should
      // not see the first-run wizard.
      hasCompletedOnboarding: Array.isArray(persistedStateTyped.projects)
        ? true
        : (persistedStateTyped.hasCompletedOnboarding ??
          currentState.hasCompletedOnboarding),
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
