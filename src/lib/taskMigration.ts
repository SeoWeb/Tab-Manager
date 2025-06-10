import type { LegacyTask, AdvancedTask, TaskMigration } from '@/types/tasks';

const generateId = () => crypto.randomUUID();
const generateTimestamp = () => new Date();

/**
 * Migration utility to convert legacy todos to enhanced tasks
 */
export const migrateLegacyTask = (legacyTask: LegacyTask): AdvancedTask => {
  const now = generateTimestamp();

  return {
    id: legacyTask.id,
    title: legacyTask.text,
    description: undefined,
    priority: 'medium', // Default priority for migrated tasks
    status: legacyTask.completed ? 'completed' : 'todo',
    dueDate: undefined,
    scheduledDate: undefined,
    estimatedDuration: undefined,
    actualDuration: undefined,
    category: legacyTask.category || 'General',
    tags: [],
    projectId: undefined,
    collectionId: undefined,
    parentTaskId: undefined,
    subtasks: [],
    attachments: [],
    notes: '',
    createdAt: now, // We don't have the original creation date
    updatedAt: now,
    completedAt: legacyTask.completed ? now : undefined,
    recurringPattern: undefined,
    reminders: [],
    assignee: undefined,
    progress: legacyTask.completed ? 100 : 0,
    comments: [],
    activities: [
      {
        id: generateId(),
        type: 'created',
        description: 'Task migrated from legacy format',
        author: 'system',
        timestamp: now,
        metadata: {
          originalFormat: 'legacy',
          migrationVersion: 1,
        },
      },
    ],
    isArchived: false,
    isFavorite: false,
    customFields: {},
  };
};

/**
 * Batch migration for multiple legacy tasks
 */
export const migrateLegacyTasks = (
  legacyTasks: LegacyTask[]
): AdvancedTask[] => {
  return legacyTasks.map(migrateLegacyTask);
};

/**
 * Migration versions for future compatibility
 */
export const taskMigrations: Record<number, TaskMigration> = {
  1: {
    version: 1,
    migrateTask: migrateLegacyTask,
  },
};

/**
 * Get the latest migration version
 */
export const getLatestMigrationVersion = (): number => {
  return Math.max(...Object.keys(taskMigrations).map(Number));
};

/**
 * Check if migration is needed
 */
export const needsMigration = (tasks: unknown[]): boolean => {
  if (!Array.isArray(tasks) || tasks.length === 0) return false;

  // Check if any task has the legacy format (has 'text' property instead of 'title')
  return tasks.some(
    (task) =>
      typeof task === 'object' &&
      task !== null &&
      'text' in task &&
      !('title' in task)
  );
};

/**
 * Perform migration if needed
 */
export const performMigrationIfNeeded = (
  legacyTasks: LegacyTask[],
  existingTasks: AdvancedTask[] = []
): { tasks: AdvancedTask[]; migrated: boolean } => {
  if (!needsMigration(legacyTasks)) {
    return { tasks: existingTasks, migrated: false };
  }

  const migratedTasks = migrateLegacyTasks(legacyTasks);

  // Combine with existing enhanced tasks, avoiding duplicates
  const existingIds = new Set(existingTasks.map((task) => task.id));
  const newTasks = migratedTasks.filter((task) => !existingIds.has(task.id));

  return {
    tasks: [...existingTasks, ...newTasks],
    migrated: newTasks.length > 0,
  };
};

/**
 * Validate task data structure
 */
export const validateTaskStructure = (task: unknown): task is AdvancedTask => {
  if (typeof task !== 'object' || task === null) return false;

  const t = task as Record<string, unknown>;

  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    ['low', 'medium', 'high', 'urgent'].includes(t.priority as string) &&
    ['todo', 'in-progress', 'blocked', 'completed', 'cancelled'].includes(
      t.status as string
    ) &&
    typeof t.category === 'string' &&
    Array.isArray(t.tags) &&
    Array.isArray(t.subtasks) &&
    Array.isArray(t.attachments) &&
    Array.isArray(t.reminders) &&
    Array.isArray(t.comments) &&
    Array.isArray(t.activities) &&
    typeof t.progress === 'number' &&
    (t.progress as number) >= 0 &&
    (t.progress as number) <= 100 &&
    t.createdAt instanceof Date &&
    t.updatedAt instanceof Date &&
    typeof t.isArchived === 'boolean' &&
    typeof t.isFavorite === 'boolean'
  );
};

/**
 * Clean and validate task data
 */
export const cleanTaskData = (task: unknown): AdvancedTask | null => {
  try {
    if (!validateTaskStructure(task)) {
      console.warn('Invalid task structure detected:', task);
      return null;
    }

    // Ensure dates are Date objects
    const cleanedTask: AdvancedTask = {
      ...task,
      createdAt:
        task.createdAt instanceof Date
          ? task.createdAt
          : new Date(task.createdAt),
      updatedAt:
        task.updatedAt instanceof Date
          ? task.updatedAt
          : new Date(task.updatedAt),
      completedAt: task.completedAt
        ? task.completedAt instanceof Date
          ? task.completedAt
          : new Date(task.completedAt)
        : undefined,
      dueDate: task.dueDate
        ? task.dueDate instanceof Date
          ? task.dueDate
          : new Date(task.dueDate)
        : undefined,
      scheduledDate: task.scheduledDate
        ? task.scheduledDate instanceof Date
          ? task.scheduledDate
          : new Date(task.scheduledDate)
        : undefined,
    };

    return cleanedTask;
  } catch (error) {
    console.error('Error cleaning task data:', error, task);
    return null;
  }
};

/**
 * Batch clean task data
 */
export const cleanTasksData = (tasks: unknown[]): AdvancedTask[] => {
  if (!Array.isArray(tasks)) return [];

  return tasks
    .map(cleanTaskData)
    .filter((task): task is AdvancedTask => task !== null);
};
