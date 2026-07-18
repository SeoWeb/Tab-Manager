import { AppState } from '../../types';
import type { AdvancedTask } from '@/types/tasks';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildTaskPatch } from '@/lib/cloudflareSync/entityPatches';
import { generateId, generateTimestamp, addActivity, getAuthor } from './utils';
import { calculateTaskStats } from './stats';

export const createSubtaskActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  addSubtask: (
    parentId: string,
    subtaskData: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities' | 'parentTaskId'
    >
  ) => {
    const subtaskId = generateId();
    set((state: AppState) => {
      const now = generateTimestamp();
      // Inherit the parent task's project so subtasks stay scoped correctly,
      // mirroring addTask's active-project fallback. The TaskDetailModal path
      // already passes projectId explicitly, but this keeps the store action
      // consistent with the strict per-project invariant for any other caller.
      const parent = state.tasks.find((t) => t.id === parentId);
      const subtask: AdvancedTask = {
        ...subtaskData,
        projectId:
          subtaskData.projectId ??
          parent?.projectId ??
          state.activeProjectId ??
          state.projects[0]?.id,
        id: subtaskId,
        parentTaskId: parentId,
        createdAt: now,
        updatedAt: now,
        activities: [
          {
            id: generateId(),
            type: 'created',
            description: 'Subtask created',
            author: getAuthor(state),
            timestamp: now,
          },
        ],
      };

      const updatedTasks = state.tasks.map((task) => {
        if (task.id === parentId) {
          return addActivity(
            { ...task, subtasks: [...task.subtasks, subtask.id] },
            {
              type: 'updated',
              description: 'Subtask added',
              author: getAuthor(state),
            }
          );
        }
        return task;
      });

      updatedTasks.push(subtask);

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync: create the subtask, and update the parent (its subtasks[] changed).
    const storeState = get();
    const subtask = storeState.tasks.find((t) => t.id === subtaskId);
    if (subtask?.projectId) {
      void enqueueCloudChange({
        projectId: subtask.projectId,
        entityType: 'task',
        entityId: subtaskId,
        operation: 'create',
        patch: buildTaskPatch(subtask),
      });
    }
    const parent = storeState.tasks.find((t) => t.id === parentId);
    if (parent?.projectId) {
      void enqueueCloudChange({
        projectId: parent.projectId,
        entityType: 'task',
        entityId: parentId,
        operation: 'update',
        patch: buildTaskPatch(parent),
      });
    }
  },

  removeSubtask: (parentId: string, subtaskId: string) => {
    // Capture the subtask's owning project before removal so its cloud delete
    // can be enqueued.
    const subtaskProjectId = get().tasks.find(
      (t) => t.id === subtaskId
    )?.projectId;

    set((state: AppState) => {
      const updatedTasks = state.tasks
        .filter((task) => task.id !== subtaskId)
        .map((task) => {
          if (task.id === parentId) {
            return addActivity(
              {
                ...task,
                subtasks: task.subtasks.filter((id) => id !== subtaskId),
              },
              {
                type: 'updated',
                description: 'Subtask removed',
                author: getAuthor(state),
              }
            );
          }
          return task;
        });

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync: delete the subtask, and update the parent (its subtasks[] changed).
    if (subtaskProjectId) {
      void enqueueCloudChange({
        projectId: subtaskProjectId,
        entityType: 'task',
        entityId: subtaskId,
        operation: 'delete',
        patch: {},
      });
    }
    const parent = get().tasks.find((t) => t.id === parentId);
    if (parent?.projectId) {
      void enqueueCloudChange({
        projectId: parent.projectId,
        entityType: 'task',
        entityId: parentId,
        operation: 'update',
        patch: buildTaskPatch(parent),
      });
    }
  },

  moveSubtask: (subtaskId: string, newParentId: string) => {
    const subtask = get().tasks.find((t) => t.id === subtaskId);
    if (!subtask || !subtask.parentTaskId) return;
    const oldParentId = subtask.parentTaskId;

    set((state: AppState) => {
      const updatedTasks = state.tasks.map((task) => {
        if (task.id === oldParentId) {
          // Remove from old parent
          return addActivity(
            {
              ...task,
              subtasks: task.subtasks.filter((id) => id !== subtaskId),
            },
            {
              type: 'updated',
              description: 'Subtask moved',
              author: getAuthor(state),
            }
          );
        } else if (task.id === newParentId) {
          // Add to new parent
          return addActivity(
            { ...task, subtasks: [...task.subtasks, subtaskId] },
            {
              type: 'updated',
              description: 'Subtask added',
              author: getAuthor(state),
            }
          );
        } else if (task.id === subtaskId) {
          // Update subtask's parent
          return addActivity(
            { ...task, parentTaskId: newParentId },
            {
              type: 'updated',
              description: 'Moved to new parent task',
              author: getAuthor(state),
            }
          );
        }
        return task;
      });

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync: the subtask's parentTaskId changed and both parents' subtasks[]
    // changed — enqueue an update for each affected task.
    const storeState = get();
    for (const tid of [oldParentId, newParentId, subtaskId]) {
      const t = storeState.tasks.find((x) => x.id === tid);
      if (t?.projectId) {
        void enqueueCloudChange({
          projectId: t.projectId,
          entityType: 'task',
          entityId: tid,
          operation: 'update',
          patch: buildTaskPatch(t),
        });
      }
    }
  },
});
