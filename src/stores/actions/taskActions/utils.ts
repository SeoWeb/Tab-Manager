import type { AppState } from '../../types';
import type {
  AdvancedTask,
  TaskViewSettings,
  TaskStats,
  TaskActivity,
} from '@/types/tasks';

export const generateId = () => crypto.randomUUID();
export const generateTimestamp = () => new Date();

export const createDefaultViewSettings = (): TaskViewSettings => ({
  mode: 'list',
  sortBy: { field: 'createdAt', direction: 'desc' },
  filters: {},
  showCompleted: true,
  showArchived: false,
  compactMode: false,
});

export const createDefaultStats = (): TaskStats => ({
  total: 0,
  completed: 0,
  inProgress: 0,
  overdue: 0,
  completionRate: 0,
  averageCompletionTime: 0,
  productivityScore: 0,
  categoryBreakdown: {},
  priorityBreakdown: { low: 0, medium: 0, high: 0, urgent: 0 },
  weeklyProgress: [],
  monthlyProgress: [],
});

export const addActivity = (
  task: AdvancedTask,
  activity: Omit<TaskActivity, 'id' | 'timestamp'>
): AdvancedTask => ({
  ...task,
  activities: [
    {
      id: generateId(),
      timestamp: generateTimestamp(),
      ...activity,
    },
    ...task.activities,
  ],
  updatedAt: generateTimestamp(),
});

export const getAuthor = (state: AppState) => {
  return (
    state.cloudSync?.account?.displayName ||
    state.cloudSync?.account?.email ||
    'user'
  );
};
