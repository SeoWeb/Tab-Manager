import { AppState } from '../../types';
import type { TaskPriority, TaskStatus } from '@/types/tasks';
import { calculateTaskStats } from './stats';

export const createTaskAnalyticsActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  refreshTaskStats: () =>
    set((state: AppState) => ({
      ...state,
      taskStats: calculateTaskStats(state.tasks),
    })),

  getTasksByStatus: (status: TaskStatus) => {
    const state = get();
    return state.tasks.filter(
      (task) => task.status === status && !task.isArchived
    );
  },

  getTasksByPriority: (priority: TaskPriority) => {
    const state = get();
    return state.tasks.filter(
      (task) => task.priority === priority && !task.isArchived
    );
  },

  getOverdueTasks: () => {
    const state = get();
    const now = new Date();
    return state.tasks.filter(
      (task) =>
        task.dueDate &&
        new Date(task.dueDate) < now &&
        task.status !== 'completed' &&
        !task.isArchived
    );
  },

  getTasksForProject: (projectId: string) => {
    const state = get();
    return state.tasks.filter(
      (task) => task.projectId === projectId && !task.isArchived
    );
  },
});
