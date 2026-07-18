import { AppState } from '../../types';
import type { AdvancedTask, TaskPriority, TaskStatus } from '@/types/tasks';
import { generateTimestamp } from './utils';

export const createTaskStatusActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  setTaskStatus: (id: string, status: TaskStatus) => {
    const actions = get();
    actions.updateTask(id, { status });
  },

  setTaskPriority: (id: string, priority: TaskPriority) => {
    const actions = get();
    actions.updateTask(id, { priority });
  },

  setTaskProgress: (id: string, progress: number) => {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    const updates: Partial<AdvancedTask> = {
      progress: clampedProgress,
    };

    if (clampedProgress === 100) {
      updates.status = 'completed';
      updates.completedAt = generateTimestamp();
    } else if (clampedProgress > 0) {
      updates.status = 'in-progress';
    }

    const actions = get();
    actions.updateTask(id, updates);
  },

  completeTask: (id: string) => {
    const actions = get();
    actions.updateTask(id, {
      status: 'completed',
      progress: 100,
      completedAt: generateTimestamp(),
    });
  },
});
