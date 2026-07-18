import { AppState } from '../../types';
import type { TaskActivity, TaskComment } from '@/types/tasks';
import { generateId, generateTimestamp } from './utils';

export const createTaskCommentActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  addTaskComment: (taskId: string, content: string, author: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const newComment: TaskComment = {
      id: generateId(),
      content,
      author,
      createdAt: generateTimestamp(),
    };

    const actions = get();
    actions.updateTask(taskId, {
      comments: [...(task.comments || []), newComment],
    });
  },

  updateTaskComment: (taskId: string, commentId: string, content: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const updatedComments = task.comments.map((comment) =>
      comment.id === commentId
        ? { ...comment, content, updatedAt: generateTimestamp() }
        : comment
    );

    const actions = get();
    actions.updateTask(taskId, { comments: updatedComments });
  },

  deleteTaskComment: (taskId: string, commentId: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const updatedComments = task.comments.filter(
      (comment) => comment.id !== commentId
    );
    const actions = get();
    actions.updateTask(taskId, { comments: updatedComments });
  },

  addTaskActivity: (
    taskId: string,
    activityData: Omit<TaskActivity, 'id' | 'timestamp'>
  ) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const newActivity: TaskActivity = {
      ...activityData,
      id: generateId(),
      timestamp: generateTimestamp(),
    };

    const actions = get();
    actions.updateTask(taskId, {
      activities: [newActivity, ...task.activities],
    });
  },
});
