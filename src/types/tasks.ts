// Enhanced Task Management Types

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus =
  | 'todo'
  | 'in-progress'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'archived';
export type TaskViewMode =
  | 'list'
  | 'kanban'
  | 'calendar'
  | 'timeline'
  | 'focus';
export type AttachmentType = 'link' | 'file' | 'image';
export type ReminderType = 'notification' | 'email';
export type RecurrenceType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  type: AttachmentType;
  size?: number;
  createdAt: Date;
}

export interface RecurringPattern {
  type: RecurrenceType;
  interval: number;
  daysOfWeek?: number[]; // 0-6, Sunday = 0
  endDate?: Date;
  maxOccurrences?: number;
}

export interface TaskReminder {
  id: string;
  type: ReminderType;
  triggerBefore: number; // minutes before due date
  message?: string;
  isActive: boolean;
}

export interface TaskComment {
  id: string;
  content: string;
  author: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface TaskActivity {
  id: string;
  type:
    | 'created'
    | 'updated'
    | 'completed'
    | 'commented'
    | 'assigned'
    | 'status_changed';
  description: string;
  author: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface AdvancedTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: Date;
  scheduledDate?: Date;
  estimatedDuration?: number; // in minutes
  actualDuration?: number;
  category: string;
  tags: string[];
  projectId?: string;
  collectionId?: string;
  parentTaskId?: string; // for subtasks
  subtasks: string[]; // child task IDs
  attachments: TaskAttachment[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  recurringPattern?: RecurringPattern;
  reminders: TaskReminder[];
  assignee?: string;
  progress: number; // 0-100%
  comments: TaskComment[];
  activities: TaskActivity[];
  isArchived: boolean;
  isFavorite: boolean;
  customFields: Record<string, unknown>;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  priority: TaskPriority;
  estimatedDuration?: number;
  subtaskTemplates: Omit<TaskTemplate, 'subtaskTemplates'>[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  isPublic: boolean;
}

export interface TaskFilter {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  categories?: string[];
  tags?: string[];
  assignee?: string[];
  projectId?: string;
  collectionId?: string;
  dueDateRange?: {
    start?: Date;
    end?: Date;
  };
  createdDateRange?: {
    start?: Date;
    end?: Date;
  };
  hasSubtasks?: boolean;
  isOverdue?: boolean;
  searchQuery?: string;
}

export interface TaskSort {
  field:
    | 'title'
    | 'priority'
    | 'dueDate'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'progress';
  direction: 'asc' | 'desc';
}

export interface TaskViewSettings {
  mode: TaskViewMode;
  groupBy?:
    | 'status'
    | 'priority'
    | 'category'
    | 'assignee'
    | 'project'
    | 'dueDate';
  sortBy: TaskSort;
  filters: TaskFilter;
  showCompleted: boolean;
  showArchived: boolean;
  compactMode: boolean;
}

export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completionRate: number;
  averageCompletionTime: number; // in hours
  productivityScore: number;
  categoryBreakdown: Record<string, number>;
  priorityBreakdown: Record<TaskPriority, number>;
  weeklyProgress: number[];
  monthlyProgress: number[];
}

export interface PomodoroSession {
  id: string;
  taskId: string;
  duration: number; // in minutes
  startTime: Date;
  endTime?: Date;
  isCompleted: boolean;
  breakDuration?: number;
  notes?: string;
}

export interface TaskBulkOperation {
  type: 'update' | 'delete' | 'archive' | 'move';
  taskIds: string[];
  updates?: Partial<AdvancedTask>;
  targetProjectId?: string;
  targetCollectionId?: string;
}

// Legacy task type for backward compatibility
export interface LegacyTask {
  id: string;
  text: string;
  completed: boolean;
  category?: string;
  /** Project this todo belongs to. Older todos are stamped at rehydrate. */
  projectId?: string;
}

// Migration utility type
export interface TaskMigration {
  version: number;
  migrateTask: (legacyTask: LegacyTask) => AdvancedTask;
}
