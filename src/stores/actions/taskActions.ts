import { AppState } from '../types';
import type {
  AdvancedTask,
  TaskTemplate,
  TaskViewSettings,
  TaskStats,
  PomodoroSession,
  TaskBulkOperation,
  TaskPriority,
  TaskStatus,
  TaskComment,
  TaskActivity,
} from '@/types/tasks';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildTaskPatch } from '@/lib/cloudflareSync/entityPatches';

// Utility functions
const generateId = () => crypto.randomUUID();
const generateTimestamp = () => new Date();

const createDefaultViewSettings = (): TaskViewSettings => ({
  mode: 'list',
  sortBy: { field: 'createdAt', direction: 'desc' },
  filters: {},
  showCompleted: true,
  showArchived: false,
  compactMode: false,
});

const createDefaultStats = (): TaskStats => ({
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

const addActivity = (
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

const getAuthor = (state: AppState) => {
  return (
    state.cloudSync?.account?.displayName ||
    state.cloudSync?.account?.email ||
    'user'
  );
};

export const calculateTaskStats = (tasks: AdvancedTask[]): TaskStats => {
  const total = tasks.filter((t) => !t.isArchived).length;
  const completed = tasks.filter(
    (t) => t.status === 'completed' && !t.isArchived
  ).length;
  const inProgress = tasks.filter(
    (t) => t.status === 'in-progress' && !t.isArchived
  ).length;
  const overdue = tasks.filter(
    (t) =>
      t.dueDate &&
      new Date(t.dueDate) < new Date() &&
      t.status !== 'completed' &&
      !t.isArchived
  ).length;

  const completionRate = total > 0 ? (completed / total) * 100 : 0;

  // Calculate average completion time
  const completedTasks = tasks.filter(
    (t) => t.status === 'completed' && t.completedAt
  );
  const avgCompletionTime =
    completedTasks.length > 0
      ? completedTasks.reduce((sum, task) => {
          const duration =
            task.completedAt!.getTime() - task.createdAt.getTime();
          return sum + duration / (1000 * 60 * 60); // Convert to hours
        }, 0) / completedTasks.length
      : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  tasks
    .filter((t) => !t.isArchived)
    .forEach((task) => {
      categoryBreakdown[task.category] =
        (categoryBreakdown[task.category] || 0) + 1;
    });

  // Priority breakdown
  const priorityBreakdown = { low: 0, medium: 0, high: 0, urgent: 0 };
  tasks
    .filter((t) => !t.isArchived)
    .forEach((task) => {
      priorityBreakdown[task.priority]++;
    });

  // Productivity score (0-100 based on completion rate, overdue tasks, etc.)
  const productivityScore = Math.max(
    0,
    Math.min(100, completionRate - (overdue / Math.max(total, 1)) * 20)
  );

  // Calculate weekly progress (tasks completed per day for the last 7 days)
  const weeklyProgress = Array(7).fill(0);
  // Calculate monthly progress (tasks completed per day for the last 30 days)
  const monthlyProgress = Array(30).fill(0);
  const nowForProgress = new Date();
  nowForProgress.setHours(0, 0, 0, 0); // Start of today

  completedTasks.forEach((task) => {
    if (task.completedAt) {
      const completedDate = new Date(task.completedAt);
      completedDate.setHours(0, 0, 0, 0);
      const diffTime = nowForProgress.getTime() - completedDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < 7) {
        // index 0 is oldest (6 days ago), index 6 is today
        weeklyProgress[6 - diffDays]++;
      }

      if (diffDays >= 0 && diffDays < 30) {
        // index 0 is oldest (29 days ago), index 29 is today
        monthlyProgress[29 - diffDays]++;
      }
    }
  });

  return {
    total,
    completed,
    inProgress,
    overdue,
    completionRate,
    averageCompletionTime: avgCompletionTime,
    productivityScore,
    categoryBreakdown,
    priorityBreakdown,
    weeklyProgress,
    monthlyProgress,
  };
};

export const createTaskActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  // Task CRUD Operations
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

  // Task Status & Progress
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
    const updates: Partial<AdvancedTask> = { progress: clampedProgress };

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

  // Subtask Management
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

  // Task Organization
  addTaskTag: (id: string, tag: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.tags.includes(tag)) return;

    const actions = get();
    actions.updateTask(id, {
      tags: [...task.tags, tag],
    });
  },

  removeTaskTag: (id: string, tag: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const actions = get();
    actions.updateTask(id, {
      tags: task.tags.filter((t) => t !== tag),
    });
  },

  setTaskCategory: (id: string, category: string) => {
    const actions = get();
    actions.updateTask(id, { category });
  },

  assignTaskToProject: (
    id: string,
    projectId: string,
    collectionId?: string
  ) => {
    const actions = get();
    actions.updateTask(id, { projectId, collectionId });
  },

  // Task Templates
  addTaskTemplate: (templateData: Omit<TaskTemplate, 'id' | 'createdAt'>) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: [
        ...state.taskTemplates,
        {
          ...templateData,
          id: generateId(),
          createdAt: generateTimestamp(),
        },
      ],
    })),

  updateTaskTemplate: (id: string, updates: Partial<TaskTemplate>) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: state.taskTemplates.map((template) =>
        template.id === id ? { ...template, ...updates } : template
      ),
    })),

  deleteTaskTemplate: (id: string) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: state.taskTemplates.filter(
        (template) => template.id !== id
      ),
    })),

  createTaskFromTemplate: (
    templateId: string,
    overrides?: Partial<AdvancedTask>
  ) => {
    const state = get();
    const template = state.taskTemplates.find((t) => t.id === templateId);
    if (!template) return;

    const taskFromTemplate: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities'
    > = {
      title: template.name,
      description: template.description,
      priority: template.priority,
      status: 'todo',
      category: template.category,
      tags: [...template.tags],
      estimatedDuration: template.estimatedDuration,
      customFields: { ...template.customFields },
      subtasks: [],
      attachments: [],
      notes: '',
      reminders: [],
      progress: 0,
      comments: [],
      isArchived: false,
      isFavorite: false,
      ...overrides,
    };

    const actions = get();
    actions.addTask(taskFromTemplate);
  },

  // Task Views & Filtering
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

  // Bulk Operations
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

  // Selection Management (stored in component state, not global state)
  selectTask: () => {
    // This would typically be handled by component state
    // Implementation depends on UI requirements
  },

  selectAllTasks: () => {
    // This would typically be handled by component state
    // Implementation depends on UI requirements
  },

  getSelectedTasks: () => {
    // This would typically be handled by component state
    // Implementation depends on UI requirements
    return [];
  },

  // Time Management
  startPomodoroSession: (taskId: string, duration: number = 25) =>
    set((state: AppState) => {
      const newSession: PomodoroSession = {
        id: generateId(),
        taskId,
        duration,
        startTime: generateTimestamp(),
        isCompleted: false,
      };

      return {
        ...state,
        activePomodoroSession: newSession,
        pomodoroSessions: [...state.pomodoroSessions, newSession],
        activeTaskId: taskId,
      };
    }),

  pausePomodoroSession: () =>
    set((state: AppState) => {
      if (!state.activePomodoroSession) return state;

      // Implementation would pause the timer
      // This is a simplified version
      return state;
    }),

  resumePomodoroSession: () =>
    set((state: AppState) => {
      if (!state.activePomodoroSession) return state;

      // Implementation would resume the timer
      // This is a simplified version
      return state;
    }),

  completePomodoroSession: () =>
    set((state: AppState) => {
      if (!state.activePomodoroSession) return state;

      const completedSession = {
        ...state.activePomodoroSession,
        endTime: generateTimestamp(),
        isCompleted: true,
      };

      const updatedSessions = state.pomodoroSessions.map((session) =>
        session.id === completedSession.id ? completedSession : session
      );

      return {
        ...state,
        activePomodoroSession: null,
        pomodoroSessions: updatedSessions,
      };
    }),

  cancelPomodoroSession: () =>
    set((state: AppState) => ({
      ...state,
      activePomodoroSession: null,
      pomodoroSessions: state.pomodoroSessions.filter(
        (session) => session.id !== state.activePomodoroSession?.id
      ),
    })),

  // Task Analytics
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

  // Task Comments & Activities
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

  // Task Search & Discovery
  searchTasks: (query: string) => {
    const state = get();
    const lowercaseQuery = query.toLowerCase();

    return state.tasks.filter(
      (task) =>
        !task.isArchived &&
        (task.title.toLowerCase().includes(lowercaseQuery) ||
          task.description?.toLowerCase().includes(lowercaseQuery) ||
          task.category.toLowerCase().includes(lowercaseQuery) ||
          task.tags.some((tag) => tag.toLowerCase().includes(lowercaseQuery)) ||
          task.notes.toLowerCase().includes(lowercaseQuery))
    );
  },

  getRecentTasks: (limit: number = 10) => {
    const state = get();
    return state.tasks
      .filter((task) => !task.isArchived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  },

  getFavoriteTasks: () => {
    const state = get();
    return state.tasks.filter((task) => task.isFavorite && !task.isArchived);
  },

  toggleTaskFavorite: (id: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const actions = get();
    actions.updateTask(id, { isFavorite: !task.isFavorite });
  },

  // Active Task Management
  setActiveTask: (id: string | null) =>
    set((state: AppState) => ({
      ...state,
      activeTaskId: id,
    })),

  getActiveTask: () => {
    const state = get();
    return state.activeTaskId
      ? state.tasks.find((task) => task.id === state.activeTaskId) || null
      : null;
  },
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
