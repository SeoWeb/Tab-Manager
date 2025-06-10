'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  PlusCircle,
  Trash2,
  Edit3,
  Star,
  Calendar,
  Tag,
  Search,
  CheckCircle2,
  Circle,
  AlertCircle,
  Timer,
  Archive,
  ArchiveRestore,
  Copy,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Target,
  Zap,
  Flag,
  Grid3X3,
  List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  AdvancedTask,
  TaskPriority,
  TaskStatus,
  TaskViewMode,
} from '@/types/tasks';
import { performMigrationIfNeeded } from '@/lib/taskMigration';
import TaskFormModal from '@/components/modals/TaskFormModal';

// Priority colors and icons
const priorityConfig = {
  low: {
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Circle,
    label: 'Low',
  },
  medium: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: AlertCircle,
    label: 'Medium',
  },
  high: {
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: Flag,
    label: 'High',
  },
  urgent: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: Zap,
    label: 'Urgent',
  },
};

// Status colors and icons
const statusConfig = {
  todo: {
    color: 'bg-gray-100 text-gray-800 border-gray-200',
    icon: Circle,
    label: 'To Do',
  },
  'in-progress': {
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Timer,
    label: 'In Progress',
  },
  blocked: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: AlertCircle,
    label: 'Blocked',
  },
  completed: {
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircle2,
    label: 'Completed',
  },
  cancelled: {
    color: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: Circle,
    label: 'Cancelled',
  },
};

interface TaskCardProps {
  task: AdvancedTask;
  isCompact?: boolean;
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onDelete: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onEdit: (task: AdvancedTask) => void;
}

const TaskCard = ({
  task,
  isCompact = false,
  onDelete,
  onToggleComplete,
  onToggleFavorite,
  onDuplicate,
  onArchive,
  onEdit,
}: TaskCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const PriorityIcon = priorityConfig[task.priority].icon;
  const StatusIcon = statusConfig[task.status].icon;

  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== 'completed';

  return (
    <Card
      className={cn(
        'transition-all duration-200 hover:shadow-md',
        task.isFavorite && 'ring-2 ring-yellow-200',
        isOverdue && 'border-red-300 bg-red-50/30',
        task.status === 'completed' && 'opacity-75',
        isCompact && 'py-2'
      )}
    >
      <CardHeader className={cn('pb-2', isCompact && 'py-2')}>
        <div className='flex items-start gap-3'>
          <Checkbox
            checked={task.status === 'completed'}
            onCheckedChange={() => onToggleComplete(task.id)}
            className='mt-1'
          />

          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-1'>
              <h4
                className={cn(
                  'font-medium text-sm leading-tight',
                  task.status === 'completed' &&
                    'line-through text-muted-foreground'
                )}
              >
                {task.title}
              </h4>
              {task.isFavorite && (
                <Star className='h-3 w-3 text-yellow-500 fill-current' />
              )}
              {isOverdue && <AlertCircle className='h-3 w-3 text-red-500' />}
            </div>

            {task.description && !isCompact && (
              <p className='text-xs text-muted-foreground mb-2 line-clamp-2'>
                {task.description}
              </p>
            )}
          </div>

          <div className='flex items-center gap-1'>
            <Badge
              variant='outline'
              className={cn(
                'text-xs px-1.5 py-0.5',
                priorityConfig[task.priority].color
              )}
            >
              <PriorityIcon className='h-3 w-3 mr-1' />
              {priorityConfig[task.priority].label}
            </Badge>

            <Button
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0'
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className='h-3 w-3' />
              ) : (
                <ChevronRight className='h-3 w-3' />
              )}
            </Button>
          </div>
        </div>

        {/* Compact info row */}
        <div className='flex items-center gap-2 text-xs text-muted-foreground ml-8'>
          <Badge
            variant='outline'
            className={cn(
              'text-xs px-1.5 py-0.5',
              statusConfig[task.status].color
            )}
          >
            <StatusIcon className='h-3 w-3 mr-1' />
            {statusConfig[task.status].label}
          </Badge>

          {task.category && (
            <Badge variant='secondary' className='text-xs px-1.5 py-0.5'>
              <Tag className='h-3 w-3 mr-1' />
              {task.category}
            </Badge>
          )}

          {task.dueDate && (
            <Badge
              variant='outline'
              className={cn(
                'text-xs px-1.5 py-0.5',
                isOverdue ? 'border-red-300 text-red-700' : 'border-gray-300'
              )}
            >
              <Calendar className='h-3 w-3 mr-1' />
              {new Date(task.dueDate).toLocaleDateString()}
            </Badge>
          )}

          {task.progress > 0 && task.progress < 100 && (
            <div className='flex items-center gap-1'>
              <Progress value={task.progress} className='w-12 h-1' />
              <span className='text-xs'>{task.progress}%</span>
            </div>
          )}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className='pt-0'>
          <Separator className='mb-3' />

          {/* Tags */}
          {task.tags.length > 0 && (
            <div className='flex flex-wrap gap-1 mb-3'>
              {task.tags.map((tag) => (
                <Badge key={tag} variant='secondary' className='text-xs'>
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Progress bar for in-progress tasks */}
          {task.status === 'in-progress' && (
            <div className='mb-3'>
              <div className='flex items-center justify-between text-xs mb-1'>
                <span>Progress</span>
                <span>{task.progress}%</span>
              </div>
              <Progress value={task.progress} className='h-2' />
            </div>
          )}

          {/* Subtasks */}
          {task.subtasks.length > 0 && (
            <div className='mb-3'>
              <div className='text-xs font-medium mb-1'>
                Subtasks ({task.subtasks.length})
              </div>
              {/* Subtask list would be rendered here */}
            </div>
          )}

          {/* Comments count */}
          {task.comments.length > 0 && (
            <div className='flex items-center gap-1 text-xs text-muted-foreground mb-3'>
              <MessageSquare className='h-3 w-3' />
              <span>
                {task.comments.length} comment
                {task.comments.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2'
              onClick={() => onEdit(task)}
              title='Edit Task'
            >
              <Edit3 className='h-3 w-3 mr-1' />
            </Button>

            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2'
              onClick={() => onToggleFavorite(task.id)}
              title='Toggle Favorite'
            >
              <Star
                className={cn(
                  'h-3 w-3 mr-1',
                  task.isFavorite && 'fill-current text-yellow-500'
                )}
              />
            </Button>

            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2'
              onClick={() => onDuplicate(task.id)}
              title='Duplicate Task'
            >
              <Copy className='h-3 w-3 mr-1' />
            </Button>

            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2'
              onClick={() => onArchive(task.id)}
              title={task.isArchived ? 'Unarchive Task' : 'Archive Task'}
            >
              {task.isArchived ? (
                <ArchiveRestore className='h-3 w-3 mr-1' />
              ) : (
                <Archive className='h-3 w-3 mr-1' />
              )}
            </Button>

            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-destructive hover:text-destructive'
              onClick={() => onDelete(task.id)}
              title='Delete Task'
            >
              <Trash2 className='h-3 w-3 mr-1' />
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default function EnhancedTodosPanelContent() {
  // Store hooks
  const tasks = useAppStoreWithDefaults((state) => state.tasks, []);
  const legacyTodos = useAppStoreWithDefaults((state) => state.todos, []);
  const taskViewSettings = useAppStoreWithDefaults(
    (state) => state.taskViewSettings,
    {
      mode: 'list' as TaskViewMode,
      sortBy: { field: 'createdAt', direction: 'desc' },
      filters: {},
      showCompleted: true,
      showArchived: false,
      compactMode: false,
    }
  );
  const taskStats = useAppStoreWithDefaults((state) => state.taskStats, {
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

  // Actions
  const addTask = useAppStoreWithDefaults(
    (state) => state.addTask,
    () => {}
  );
  const updateTask = useAppStoreWithDefaults(
    (state) => state.updateTask,
    () => {}
  );
  const deleteTask = useAppStoreWithDefaults(
    (state) => state.deleteTask,
    () => {}
  );
  const duplicateTask = useAppStoreWithDefaults(
    (state) => state.duplicateTask,
    () => {}
  );
  const archiveTask = useAppStoreWithDefaults(
    (state) => state.archiveTask,
    () => {}
  );
  const unarchiveTask = useAppStoreWithDefaults(
    (state) => state.unarchiveTask,
    () => {}
  );
  const completeTask = useAppStoreWithDefaults(
    (state) => state.completeTask,
    () => {}
  );
  const setTaskViewMode = useAppStoreWithDefaults(
    (state) => state.setTaskViewMode,
    () => {}
  );
  const toggleShowCompleted = useAppStoreWithDefaults(
    (state) => state.toggleShowCompleted,
    () => {}
  );
  const toggleShowArchived = useAppStoreWithDefaults(
    (state) => state.toggleShowArchived,
    () => {}
  );
  const toggleTaskFavorite = useAppStoreWithDefaults(
    (state) => state.toggleTaskFavorite,
    () => {}
  );

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AdvancedTask | undefined>(
    undefined
  );

  // Migration effect
  useEffect(() => {
    if (legacyTodos.length > 0 && tasks.length === 0) {
      const { tasks: migratedTasks, migrated } = performMigrationIfNeeded(
        legacyTodos,
        tasks
      );
      if (migrated) {
        // This would trigger a migration in the store
        console.log(
          'Migrating legacy todos to enhanced tasks:',
          migratedTasks.length
        );
      }
    }
  }, [legacyTodos, tasks]);

  // Filtered and sorted tasks
  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !task.title.toLowerCase().includes(query) &&
          !task.description?.toLowerCase().includes(query) &&
          !task.category.toLowerCase().includes(query) &&
          !task.tags.some((tag) => tag.toLowerCase().includes(query))
        ) {
          return false;
        }
      }

      // Status filters
      if (taskViewSettings.filters.status?.length) {
        if (!taskViewSettings.filters.status.includes(task.status))
          return false;
      }

      // Priority filters
      if (taskViewSettings.filters.priority?.length) {
        if (!taskViewSettings.filters.priority.includes(task.priority))
          return false;
      }

      // Show/hide archived
      if (!taskViewSettings.showArchived && task.isArchived) {
        return false;
      }

      // Show/hide completed
      if (!taskViewSettings.showCompleted && task.status === 'completed') {
        return false;
      }

      return true;
    });

    // Sorting
    const { field, direction } = taskViewSettings.sortBy;
    filtered.sort((a, b) => {
      let aValue: string | number = 0;
      let bValue: string | number = 0;

      // Handle date fields
      if (
        field === 'dueDate' ||
        field === 'createdAt' ||
        field === 'updatedAt'
      ) {
        aValue = a[field] ? new Date(a[field]!).getTime() : 0;
        bValue = b[field] ? new Date(b[field]!).getTime() : 0;
      }

      // Handle priority field
      else if (field === 'priority') {
        const priorityOrder: Record<TaskPriority, number> = {
          low: 1,
          medium: 2,
          high: 3,
          urgent: 4,
        };
        aValue = priorityOrder[a.priority];
        bValue = priorityOrder[b.priority];
      }

      // Handle status field
      else if (field === 'status') {
        const statusOrder: Record<TaskStatus, number> = {
          todo: 1,
          'in-progress': 2,
          blocked: 3,
          completed: 4,
          cancelled: 5,
        };
        aValue = statusOrder[a.status];
        bValue = statusOrder[b.status];
      }

      // Handle string fields
      else if (field === 'title') {
        aValue = a.title.toLowerCase();
        bValue = b.title.toLowerCase();
      }

      // Handle number fields
      else if (field === 'progress') {
        aValue = a.progress;
        bValue = b.progress;
      }

      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [tasks, searchQuery, taskViewSettings]);

  const handleSaveTask = (
    taskData:
      | Omit<AdvancedTask, 'id' | 'createdAt' | 'updatedAt' | 'activities'>
      | AdvancedTask
  ) => {
    if ('id' in taskData) {
      updateTask(taskData.id, taskData);
    } else {
      addTask(taskData);
    }
    setIsTaskModalOpen(false);
    setEditingTask(undefined);
  };

  const handleOpenNewTaskModal = () => {
    setEditingTask(undefined);
    setIsTaskModalOpen(true);
  };

  const handleToggleComplete = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    if (task.status === 'completed') {
      updateTask(id, { status: 'todo', progress: 0, completedAt: undefined });
    } else {
      completeTask(id);
    }
  };

  const handleArchiveTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    if (task.isArchived) {
      unarchiveTask(id);
    } else {
      archiveTask(id);
    }
  };

  const handleEditTask = (task: AdvancedTask) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold text-foreground'>
          Enhanced Tasks
        </h3>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() =>
              setTaskViewMode(
                taskViewSettings.mode === 'list' ? 'kanban' : 'list'
              )
            }
          >
            {taskViewSettings.mode === 'list' ? (
              <Grid3X3 className='h-4 w-4' />
            ) : (
              <List className='h-4 w-4' />
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3 text-center'>
        <div className='bg-gray-100 rounded-md p-2'>
          <div className='font-bold text-lg text-gray-800'>
            {taskStats.total}
          </div>
          <div className='text-xs text-gray-600'>Total</div>
        </div>
        <div className='bg-green-100 rounded-md p-2'>
          <div className='font-bold text-lg text-green-800'>
            {taskStats.completed}
          </div>
          <div className='text-xs text-green-600'>Completed</div>
        </div>
        <div className='bg-blue-100 rounded-md p-2'>
          <div className='font-bold text-lg text-blue-800'>
            {taskStats.inProgress}
          </div>
          <div className='text-xs text-blue-600'>In Progress</div>
        </div>
        <div className='bg-red-100 rounded-md p-2'>
          <div className='font-bold text-lg text-red-800'>
            {taskStats.overdue}
          </div>
          <div className='text-xs text-red-600'>Overdue</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className='space-y-2'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
          <Input
            placeholder='Search tasks...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9 text-sm'
          />
        </div>

        <div className='flex items-center gap-2 text-xs'>
          <Button
            variant={taskViewSettings.showCompleted ? 'default' : 'outline'}
            size='sm'
            onClick={toggleShowCompleted}
            className='h-7'
          >
            Show Completed
          </Button>
          <Button
            variant={taskViewSettings.showArchived ? 'default' : 'outline'}
            size='sm'
            onClick={toggleShowArchived}
            className='h-7'
          >
            Show Archived
          </Button>
        </div>
      </div>

      <Button
        onClick={handleOpenNewTaskModal}
        className='w-full'
        variant='outline'
      >
        <PlusCircle className='h-4 w-4 mr-2' />
        Add New Task
      </Button>

      <TaskFormModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSave={handleSaveTask}
        task={editingTask}
      />

      {/* Task List */}
      <div className='space-y-2'>
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isCompact={taskViewSettings.compactMode}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onToggleComplete={handleToggleComplete}
              onToggleFavorite={toggleTaskFavorite}
              onDuplicate={duplicateTask}
              onArchive={handleArchiveTask}
              onEdit={handleEditTask}
            />
          ))
        ) : (
          <div className='text-center py-8 text-muted-foreground'>
            <Target className='h-12 w-12 mx-auto mb-4 opacity-50' />
            <p className='text-sm'>
              {searchQuery
                ? 'No tasks match your search.'
                : 'No tasks yet. Add your first task!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
