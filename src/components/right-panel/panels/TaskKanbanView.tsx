'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Circle,
  Timer,
  AlertCircle,
  CheckCircle2,
  Star,
  Calendar,
  Tag,
  Plus,
  Edit,
  ArrowUp,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';

// Status configuration for Kanban columns
const kanbanColumns: Array<{
  status: TaskStatus;
  title: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    status: 'todo',
    title: 'To Do',
    color: 'bg-gray-50 border-gray-200',
    icon: Circle,
  },
  {
    status: 'in-progress',
    title: 'In Progress',
    color: 'bg-blue-50 border-blue-200',
    icon: Timer,
  },
  {
    status: 'blocked',
    title: 'Blocked',
    color: 'bg-red-50 border-red-200',
    icon: AlertCircle,
  },
  {
    status: 'completed',
    title: 'Completed',
    color: 'bg-green-50 border-green-200',
    icon: CheckCircle2,
  },
];

// Priority colors
const priorityConfig = {
  low: { color: 'bg-blue-100 text-blue-800 border-blue-200', label: 'Low' },
  medium: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    label: 'Medium',
  },
  high: {
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    label: 'High',
  },
  urgent: { color: 'bg-red-100 text-red-800 border-red-200', label: 'Urgent' },
};

interface KanbanTaskCardProps {
  task: AdvancedTask;
  allTasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
}

const KanbanTaskCard = ({
  task,
  allTasks,
  onEdit,
  onView,
  onArchive,
}: KanbanTaskCardProps) => {
  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== 'completed';

  const parentTask = task.parentTaskId
    ? allTasks.find((t) => t.id === task.parentTaskId)
    : null;

  return (
    <Card
      className={cn(
        'mb-2 cursor-pointer transition-all duration-200 hover:shadow-md',
        task.isFavorite && 'ring-1 ring-yellow-300',
        isOverdue && 'border-red-300 bg-red-50/30'
      )}
    >
      <CardContent className='p-3' onClick={() => onView(task)}>
        <div className='space-y-2'>
          {/* Title and favorite */}
          <div className='flex items-start justify-between gap-2'>
            <h4 className='font-medium text-sm leading-tight line-clamp-2'>
              {task.title}
            </h4>
            <div className='flex items-center gap-1 flex-shrink-0'>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6'
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
              >
                <Edit className='h-3 w-3' />
              </Button>
              {task.isFavorite && (
                <Star className='h-3 w-3 text-yellow-500 fill-current' />
              )}
              {isOverdue && <AlertCircle className='h-3 w-3 text-red-500' />}
              {task.status === 'completed' && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6'
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive(task.id);
                  }}
                >
                  <Archive className='h-3 w-3' />
                </Button>
              )}
            </div>
          </div>

          {/* Description or Parent Task */}
          {parentTask ? (
            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
              <ArrowUp className='h-3 w-3 flex-shrink-0' />
              <span className='truncate font-medium'>{parentTask.title}</span>
            </div>
          ) : (
            task.description && (
              <p className='text-xs text-muted-foreground line-clamp-2'>
                {task.description}
              </p>
            )
          )}

          {/* Priority badge */}
          <div className='flex items-center justify-between'>
            <Badge
              variant='outline'
              className={cn(
                'text-xs px-1.5 py-0.5',
                priorityConfig[task.priority].color
              )}
            >
              {priorityConfig[task.priority].label}
            </Badge>

            {/* Progress indicator for in-progress tasks */}
            {task.status === 'in-progress' && task.progress > 0 && (
              <div className='text-xs text-muted-foreground'>
                {task.progress}%
              </div>
            )}
          </div>

          {/* Tags */}
          {task.tags.length > 0 && (
            <div className='flex flex-wrap gap-1'>
              {task.tags.slice(0, 3).map((tag) => (
                <Badge
                  key={tag}
                  variant='secondary'
                  className='text-xs px-1.5 py-0.5'
                >
                  {tag}
                </Badge>
              ))}
              {task.tags.length > 3 && (
                <Badge variant='secondary' className='text-xs px-1.5 py-0.5'>
                  +{task.tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Footer info */}
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <div className='flex items-center gap-2'>
              {task.category && (
                <div className='flex items-center gap-1'>
                  <Tag className='h-3 w-3' />
                  <span>{task.category}</span>
                </div>
              )}

              {task.subtasks.length > 0 && (
                <span>{task.subtasks.length} subtasks</span>
              )}
            </div>

            {task.dueDate && (
              <div
                className={cn(
                  'flex items-center gap-1',
                  isOverdue ? 'text-red-600' : 'text-muted-foreground'
                )}
              >
                <Calendar className='h-3 w-3' />
                <span>{new Date(task.dueDate).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const SortableTaskCard = ({
  task,
  allTasks,
  onUpdate,
  onStatusChange,
  onEdit,
  onView,
  onArchive,
}: KanbanTaskCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'Task', task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className='bg-card opacity-50 p-3 rounded-lg border-2 border-primary'
      ></div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanTaskCard
        task={task}
        allTasks={allTasks}
        onUpdate={onUpdate}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
        onView={onView}
        onArchive={onArchive}
      />
    </div>
  );
};

interface KanbanColumnProps {
  column: (typeof kanbanColumns)[0];
  tasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
}

const KanbanColumn = ({
  column,
  tasks,
  onUpdate,
  onStatusChange,
  onAddTask,
  onEdit,
  onView,
  onArchive,
}: KanbanColumnProps) => {
  const Icon = column.icon;
  const { setNodeRef } = useDroppable({
    id: column.status,
    data: {
      type: 'Column',
    },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col h-full rounded-lg border-2 border-dashed',
        column.color
      )}
    >
      {/* Column Header */}
      <div className='p-3 border-b bg-gray-100 dark:bg-gray-800 rounded-t-lg'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Icon className='h-4 w-4' />
            <h3 className='font-medium text-sm'>{column.title}</h3>
            <Badge variant='secondary' className='text-xs'>
              {tasks.length}
            </Badge>
          </div>
          <Button
            variant='ghost'
            size='sm'
            className='h-6 w-6 p-0'
            onClick={() => onAddTask(column.status)}
          >
            <Plus className='h-3 w-3' />
          </Button>
        </div>
      </div>

      {/* Column Content */}
      <ScrollArea className='flex-1 p-3'>
        <div className='space-y-2'>
          <SortableContext items={tasks.map((t) => t.id)}>
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                allTasks={tasks}
                onUpdate={onUpdate}
                onStatusChange={onStatusChange}
                onEdit={onEdit}
                onView={onView}
                onArchive={onArchive}
              />
            ))}
          </SortableContext>

          {tasks.length === 0 && (
            <div className='text-center py-8 text-muted-foreground'>
              <div className='text-xs'>No tasks</div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

interface TaskKanbanViewProps {
  tasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
  showCompleted?: boolean;
  showArchived?: boolean;
}

export default function TaskKanbanView({
  tasks,
  onUpdate,
  onStatusChange,
  onAddTask,
  onEdit,
  onView,
  onArchive,
  showCompleted = true,
  showArchived = false,
}: TaskKanbanViewProps) {
  const [activeTask, setActiveTask] = useState<AdvancedTask | null>(null);

  // Filter tasks based on settings
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!showCompleted && task.status === 'completed') return false;
      if (!showArchived && task.isArchived) return false;
      return true;
    });
  }, [tasks, showCompleted, showArchived]);

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, AdvancedTask[]> = {
      todo: [],
      'in-progress': [],
      blocked: [],
      completed: [],
      cancelled: [],
      archived: [],
    };

    filteredTasks.forEach((task) => {
      grouped[task.status].push(task);
    });

    return grouped;
  }, [filteredTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeTask = filteredTasks.find((t) => t.id === activeId);
    let overColumn: (typeof kanbanColumns)[0] | undefined;

    if (over.data.current?.type === 'Column') {
      overColumn = kanbanColumns.find((c) => c.status === over.id);
    } else {
      const overTask = filteredTasks.find((t) => t.id === over.id);
      if (overTask) {
        overColumn = kanbanColumns.find((c) => c.status === overTask.status);
      }
    }

    if (!activeTask || !overColumn) return;

    if (activeTask.status !== overColumn.status) {
      onStatusChange(activeTask.id, overColumn.status);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveATask = active.data.current?.type === 'Task';
    const isOverAColumn = over.data.current?.type === 'Column';

    if (isActiveATask && isOverAColumn && active.data.current?.task) {
      const activeTask = active.data.current.task as AdvancedTask;
      const overColumnStatus = over.id as TaskStatus;
      if (activeTask.status !== overColumnStatus) {
        // Optimistically update UI, but final change is on drag end
      }
    }
  };

  return (
    <div className='h-full'>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full'>
          {kanbanColumns.map((column) => (
            <KanbanColumn
              key={column.status}
              column={column}
              tasks={tasksByStatus[column.status]}
              onUpdate={onUpdate}
              onStatusChange={onStatusChange}
              onAddTask={onAddTask}
              onEdit={onEdit}
              onView={onView}
              onArchive={onArchive}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <KanbanTaskCard
              task={activeTask}
              allTasks={tasks}
              onUpdate={() => {}}
              onStatusChange={() => {}}
              onEdit={() => {}}
              onView={() => {}}
              onArchive={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
