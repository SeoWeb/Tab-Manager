import { AppState } from '../../types';
import type { TaskBulkOperation } from '@/types/tasks';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildTaskPatch } from '@/lib/cloudflareSync/entityPatches';
import { generateTimestamp, addActivity, getAuthor } from './utils';
import { calculateTaskStats } from './stats';

export const createTaskBulkActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  performBulkOperation: (operation: TaskBulkOperation) => {
    // For deletes, capture each target's owning project before the tasks are
    // removed so cloud deletes can be enqueued afterwards.
    const deleteProjects = new Map<string, string | undefined>();
    if (operation.type === 'delete') {
      for (const task of get().tasks) {
        if (operation.taskIds.includes(task.id)) {
          deleteProjects.set(task.id, task.projectId);
        }
      }
    }

    set((state: AppState) => {
      let updatedTasks = [...state.tasks];

      switch (operation.type) {
        case 'update':
          if (operation.updates) {
            updatedTasks = updatedTasks.map((task) =>
              operation.taskIds.includes(task.id)
                ? {
                    ...task,
                    ...operation.updates,
                    updatedAt: generateTimestamp(),
                  }
                : task
            );
          }
          break;

        case 'delete':
          updatedTasks = updatedTasks.filter(
            (task) => !operation.taskIds.includes(task.id)
          );
          break;

        case 'archive':
          updatedTasks = updatedTasks.map((task) =>
            operation.taskIds.includes(task.id)
              ? addActivity(
                  { ...task, isArchived: true },
                  {
                    type: 'updated',
                    description: 'Task archived (bulk)',
                    author: getAuthor(state),
                  }
                )
              : task
          );
          break;

        case 'move':
          if (operation.targetProjectId) {
            updatedTasks = updatedTasks.map((task) =>
              operation.taskIds.includes(task.id)
                ? {
                    ...task,
                    projectId: operation.targetProjectId,
                    collectionId: operation.targetCollectionId,
                    updatedAt: generateTimestamp(),
                  }
                : task
            );
          }
          break;
      }

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync each affected task. Deletes enqueue a cloud delete (the task is gone
    // from state, so its project was captured above); update/archive/move
    // enqueue the merged task's full payload under its current project.
    const after = get().tasks;
    for (const taskId of operation.taskIds) {
      if (operation.type === 'delete') {
        const pid = deleteProjects.get(taskId);
        if (pid) {
          void enqueueCloudChange({
            projectId: pid,
            entityType: 'task',
            entityId: taskId,
            operation: 'delete',
            patch: {},
          });
        }
      } else {
        const t = after.find((x) => x.id === taskId);
        if (t?.projectId) {
          void enqueueCloudChange({
            projectId: t.projectId,
            entityType: 'task',
            entityId: taskId,
            operation: 'update',
            patch: buildTaskPatch(t),
          });
        }
      }
    }
  },
});
