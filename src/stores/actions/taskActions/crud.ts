import { AppState } from '../../types';
import type { AdvancedTask } from '@/types/tasks';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildTaskPatch } from '@/lib/cloudflareSync/entityPatches';
import { generateId, generateTimestamp, addActivity, getAuthor } from './utils';
import { calculateTaskStats } from './stats';

export const createTaskCrudActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  addTask: (
    taskData: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities'
    >
  ) => {
    const newTaskId = generateId();
    set((state: AppState) => {
      const now = generateTimestamp();
      const newTask: AdvancedTask = {
        ...taskData,
        // Strict per-project: default to the active project unless the caller
        // explicitly assigned one.
        projectId:
          taskData.projectId ?? state.activeProjectId ?? state.projects[0]?.id,
        id: newTaskId,
        createdAt: now,
        updatedAt: now,
        activities: [
          {
            id: generateId(),
            type: 'created',
            description: 'Task created',
            author: getAuthor(state),
            timestamp: now,
          },
        ],
      };

      const updatedTasks = [...state.tasks, newTask];
      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Enqueue a task create for cloud projects. Read the materialized task from
    // the store so the patch reflects defaulted fields (e.g. projectId resolved
    // to the active project). enqueueCloudChange is a no-op for local-only.
    const newTask = get().tasks.find((t) => t.id === newTaskId);
    if (newTask?.projectId) {
      void enqueueCloudChange({
        projectId: newTask.projectId,
        entityType: 'task',
        entityId: newTaskId,
        operation: 'create',
        patch: buildTaskPatch(newTask),
      });
    }
    return newTaskId;
  },

  updateTask: (id: string, updates: Partial<AdvancedTask>) => {
    set((state: AppState) => {
      const updatedTasks = state.tasks.map((task) => {
        if (task.id === id) {
          const updatedTask = {
            ...task,
            ...updates,
            updatedAt: generateTimestamp(),
          };

          // Add activity for significant changes
          if (updates.status && updates.status !== task.status) {
            updatedTask.activities = [
              {
                id: generateId(),
                type: 'status_changed',
                description: `Status changed from ${task.status} to ${updates.status}`,
                author: getAuthor(state),
                timestamp: generateTimestamp(),
              },
              ...updatedTask.activities,
            ];
          }

          if (updates.status === 'completed' && task.status !== 'completed') {
            updatedTask.completedAt = generateTimestamp();
            updatedTask.progress = 100;
          }

          return updatedTask;
        }
        return task;
      });

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Enqueue the task's full current payload. The backend replaces payload_json
    // wholesale on update, so read the merged task after the optimistic update
    // and send all flat fields (a partial patch would clobber the others).
    const updated = get().tasks.find((t) => t.id === id);
    if (updated?.projectId) {
      void enqueueCloudChange({
        projectId: updated.projectId,
        entityType: 'task',
        entityId: id,
        operation: 'update',
        patch: buildTaskPatch(updated),
      });
    }
  },

  deleteTask: (id: string) => {
    // Resolve the deletion set (a task plus its recursive subtasks) from the
    // current state before `set` removes them, so we can both filter in the
    // reducer and enqueue a cloud delete for each removed id.
    const currentTasks = get().tasks;
    const tasksToDelete = new Set<string>();
    const findSubtasksRecursively = (taskId: string) => {
      if (tasksToDelete.has(taskId)) return;
      tasksToDelete.add(taskId);
      const task = currentTasks.find((t) => t.id === taskId);
      if (task) {
        task.subtasks.forEach(findSubtasksRecursively);
      }
    };

    findSubtasksRecursively(id);

    // Capture each deleted task's owning project before removal.
    const deletions = currentTasks
      .filter((t) => tasksToDelete.has(t.id))
      .map((t) => ({ id: t.id, projectId: t.projectId }));

    set((state: AppState) => {
      const updatedTasks = state.tasks.filter(
        (task) => !tasksToDelete.has(task.id)
      );

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
        activeTaskId: tasksToDelete.has(state.activeTaskId || '')
          ? null
          : state.activeTaskId,
      };
    });

    // Enqueue a cloud delete for the task and each cascaded subtask. The backend
    // cascades project deletes but not task deletes, so each id is deleted
    // explicitly.
    for (const del of deletions) {
      if (del.projectId) {
        void enqueueCloudChange({
          projectId: del.projectId,
          entityType: 'task',
          entityId: del.id,
          operation: 'delete',
          patch: {},
        });
      }
    }
  },

  duplicateTask: (id: string) => {
    const duplicatedId = generateId();
    set((state: AppState) => {
      const originalTask = state.tasks.find((task) => task.id === id);
      if (!originalTask) return state;

      const now = generateTimestamp();
      const duplicatedTask: AdvancedTask = {
        ...originalTask,
        id: duplicatedId,
        title: `${originalTask.title} (Copy)`,
        status: 'todo',
        progress: 0,
        completedAt: undefined,
        createdAt: now,
        updatedAt: now,
        activities: [
          {
            id: generateId(),
            type: 'created',
            description: `Duplicated from task: ${originalTask.title}`,
            author: getAuthor(state),
            timestamp: now,
          },
        ],
        subtasks: [], // Don't duplicate subtasks
        comments: [], // Don't duplicate comments
      };

      const updatedTasks = [...state.tasks, duplicatedTask];
      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync the duplicate as a new task create. It inherits the original's
    // projectId via the spread above.
    const duplicated = get().tasks.find((t) => t.id === duplicatedId);
    if (duplicated?.projectId) {
      void enqueueCloudChange({
        projectId: duplicated.projectId,
        entityType: 'task',
        entityId: duplicatedId,
        operation: 'create',
        patch: buildTaskPatch(duplicated),
      });
    }
  },

  archiveTask: (id: string) => {
    const tasksToArchive = new Set<string>();
    const findSubtasks = (taskId: string) => {
      if (tasksToArchive.has(taskId)) return;
      tasksToArchive.add(taskId);
      const task = get().tasks.find((t) => t.id === taskId);
      if (task) {
        task.subtasks.forEach(findSubtasks);
      }
    };
    findSubtasks(id);

    set((state: AppState) => {
      const updatedTasks = state.tasks.map((task) =>
        tasksToArchive.has(task.id)
          ? addActivity(
              { ...task, isArchived: true },
              {
                type: 'updated',
                description: 'Task archived',
                author: getAuthor(state),
              }
            )
          : task
      );

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    // Sync the archive toggle for each affected task (the subtask cascade is
    // included). isArchived now rides in the task patch.
    for (const archivedId of tasksToArchive) {
      const updated = get().tasks.find((t) => t.id === archivedId);
      if (updated?.projectId) {
        void enqueueCloudChange({
          projectId: updated.projectId,
          entityType: 'task',
          entityId: archivedId,
          operation: 'update',
          patch: buildTaskPatch(updated),
        });
      }
    }
  },

  unarchiveTask: (id: string) => {
    set((state: AppState) => {
      const updatedTasks = state.tasks.map((task) =>
        task.id === id
          ? addActivity(
              { ...task, isArchived: false },
              {
                type: 'updated',
                description: 'Task unarchived',
                author: getAuthor(state),
              }
            )
          : task
      );

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    });

    const updated = get().tasks.find((t) => t.id === id);
    if (updated?.projectId) {
      void enqueueCloudChange({
        projectId: updated.projectId,
        entityType: 'task',
        entityId: id,
        operation: 'update',
        patch: buildTaskPatch(updated),
      });
    }
  },
});
