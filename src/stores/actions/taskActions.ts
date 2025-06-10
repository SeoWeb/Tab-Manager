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

const calculateTaskStats = (tasks: AdvancedTask[]): TaskStats => {
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
    weeklyProgress: [], // TODO: Implement weekly progress calculation
    monthlyProgress: [], // TODO: Implement monthly progress calculation
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
        id: newTaskId,
        createdAt: now,
        updatedAt: now,
        activities: [
          {
            id: generateId(),
            type: 'created',
            description: 'Task created',
            author: 'user', // TODO: Get actual user
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
    return newTaskId;
  },

  updateTask: (id: string, updates: Partial<AdvancedTask>) =>
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
                author: 'user',
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
    }),

  deleteTask: (id: string) =>
    set((state: AppState) => {
      const tasksToDelete = new Set<string>();
      const findSubtasksRecursively = (taskId: string) => {
        if (tasksToDelete.has(taskId)) return;
        tasksToDelete.add(taskId);
        const task = state.tasks.find((t) => t.id === taskId);
        if (task) {
          task.subtasks.forEach(findSubtasksRecursively);
        }
      };

      findSubtasksRecursively(id);

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
    }),

  duplicateTask: (id: string) =>
    set((state: AppState) => {
      const originalTask = state.tasks.find((task) => task.id === id);
      if (!originalTask) return state;

      const now = generateTimestamp();
      const duplicatedTask: AdvancedTask = {
        ...originalTask,
        id: generateId(),
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
            author: 'user',
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
    }),

  archiveTask: (id: string) =>
    set((state: AppState) => {
      const tasksToArchive = new Set<string>();
      const findSubtasks = (taskId: string) => {
        if (tasksToArchive.has(taskId)) return;
        tasksToArchive.add(taskId);
        const task = state.tasks.find((t) => t.id === taskId);
        if (task) {
          task.subtasks.forEach(findSubtasks);
        }
      };

      findSubtasks(id);

      const updatedTasks = state.tasks.map((task) => {
        if (tasksToArchive.has(task.id)) {
          return addActivity(
            { ...task, isArchived: true },
            { type: 'updated', description: 'Task archived', author: 'user' }
          );
        }
        return task;
      });

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    }),

  unarchiveTask: (id: string) =>
    set((state: AppState) => {
      const updatedTasks = state.tasks.map((task) =>
        task.id === id
          ? addActivity(
              { ...task, isArchived: false },
              {
                type: 'updated',
                description: 'Task unarchived',
                author: 'user',
              }
            )
          : task
      );

      return {
        ...state,
        tasks: updatedTasks,
        taskStats: calculateTaskStats(updatedTasks),
      };
    }),

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
  ) =>
    set((state: AppState) => {
      const now = generateTimestamp();
      const subtask: AdvancedTask = {
        ...subtaskData,
        id: generateId(),
        parentTaskId: parentId,
        createdAt: now,
        updatedAt: now,
        activities: [
          {
            id: generateId(),
            type: 'created',
            description: 'Subtask created',
            author: 'user',
            timestamp: now,
          },
        ],
      };

      const updatedTasks = state.tasks.map((task) => {
        if (task.id === parentId) {
          return addActivity(
            { ...task, subtasks: [...task.subtasks, subtask.id] },
            { type: 'updated', description: 'Subtask added', author: 'user' }
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
    }),

  removeSubtask: (parentId: string, subtaskId: string) =>
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
                author: 'user',
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
    }),

  moveSubtask: (subtaskId: string, newParentId: string) =>
    set((state: AppState) => {
      const subtask = state.tasks.find((t) => t.id === subtaskId);
      if (!subtask || !subtask.parentTaskId) return state;

      const oldParentId = subtask.parentTaskId;

      const updatedTasks = state.tasks.map((task) => {
        if (task.id === oldParentId) {
          // Remove from old parent
          return addActivity(
            {
              ...task,
              subtasks: task.subtasks.filter((id) => id !== subtaskId),
            },
            { type: 'updated', description: 'Subtask moved', author: 'user' }
          );
        } else if (task.id === newParentId) {
          // Add to new parent
          return addActivity(
            { ...task, subtasks: [...task.subtasks, subtaskId] },
            { type: 'updated', description: 'Subtask added', author: 'user' }
          );
        } else if (task.id === subtaskId) {
          // Update subtask's parent
          return addActivity(
            { ...task, parentTaskId: newParentId },
            {
              type: 'updated',
              description: 'Moved to new parent task',
              author: 'user',
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
    }),

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
  performBulkOperation: (operation: TaskBulkOperation) =>
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
                    author: 'user',
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
    }),

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
