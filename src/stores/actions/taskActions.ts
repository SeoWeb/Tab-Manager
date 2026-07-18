import { AppState } from '../types';
import {
  generateId,
  generateTimestamp,
  createDefaultViewSettings,
  createDefaultStats,
  addActivity,
  getAuthor,
} from './taskActions/utils';
import { calculateTaskStats } from './taskActions/stats';
import { createTaskCrudActions } from './taskActions/crud';
import { createSubtaskActions } from './taskActions/subtasks';
import { createTaskOrganizationActions } from './taskActions/organization';
import { createTaskViewActions } from './taskActions/views';
import { createTaskStatusActions } from './taskActions/status';
import { createTaskBulkActions } from './taskActions/bulk';
import { createPomodoroActions } from './taskActions/pomodoro';
import { createTaskAnalyticsActions } from './taskActions/analytics';
import { createTaskCommentActions } from './taskActions/comments';
import { createTaskSearchActions } from './taskActions/search';
import { createTaskActiveActions } from './taskActions/active';

export {
  generateId,
  generateTimestamp,
  createDefaultViewSettings,
  createDefaultStats,
  addActivity,
  getAuthor,
  calculateTaskStats,
};

export const createTaskActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  ...createTaskCrudActions(set, get),
  ...createSubtaskActions(set, get),
  ...createTaskOrganizationActions(set, get),
  ...createTaskViewActions(set),
  ...createTaskStatusActions(set, get),
  ...createTaskBulkActions(set, get),
  ...createPomodoroActions(set),
  ...createTaskAnalyticsActions(set, get),
  ...createTaskCommentActions(set, get),
  ...createTaskSearchActions(set, get),
  ...createTaskActiveActions(set, get),
});

// Initialize default values for new state properties
export const initializeTaskState = () => ({
  tasks: [],
  taskTemplates: [],
  taskViewSettings: createDefaultViewSettings(),
  taskStats: createDefaultStats(),
  pomodoroSessions: [],
  activeTaskId: null,
  activePomodoroSession: null,
});
