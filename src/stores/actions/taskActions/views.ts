import { AppState } from '../../types';
import type { TaskViewSettings } from '@/types/tasks';

export const createTaskViewActions = (
  set: (fn: (state: AppState) => AppState) => void
) => ({
  setTaskViewMode: (mode: TaskViewSettings['mode']) =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        mode,
      },
    })),

  setTaskFilters: (filters: Partial<TaskViewSettings['filters']>) =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        filters: {
          ...state.taskViewSettings.filters,
          ...filters,
        },
      },
    })),

  setTaskSort: (sortBy: TaskViewSettings['sortBy']) =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        sortBy,
      },
    })),

  setTaskGroupBy: (groupBy: TaskViewSettings['groupBy']) =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        groupBy,
      },
    })),

  toggleShowCompleted: () =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        showCompleted: !state.taskViewSettings.showCompleted,
      },
    })),

  toggleShowArchived: () =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        showArchived: !state.taskViewSettings.showArchived,
      },
    })),

  toggleCompactMode: () =>
    set((state: AppState) => ({
      ...state,
      taskViewSettings: {
        ...state.taskViewSettings,
        compactMode: !state.taskViewSettings.compactMode,
      },
    })),
});
