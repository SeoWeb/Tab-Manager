import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  Star,
  Calendar,
  Tag,
  Edit,
  ArrowUp,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import type { CloudMember } from '@/lib/cloudflareSync/types';

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
};

// Priority colors
export const priorityConfig = {
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

export interface KanbanTaskCardProps {
  task: AdvancedTask;
  allTasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
  projectMembers?: Record<string, CloudMember[]>;
}

export const KanbanTaskCard = ({
  task,
  allTasks,
  onEdit,
  onView,
  onArchive,
  projectMembers,
}: KanbanTaskCardProps) => {
  const assigneeInfo = useMemo(() => {
    if (!task.assignee || !task.projectId || !projectMembers) return null;
    const membersList = projectMembers[task.projectId] || [];
    return membersList.find((m) => m.user_id === task.assignee) || null;
  }, [task.assignee, task.projectId, projectMembers]);
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

            <div className='flex items-center gap-2'>
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
              {assigneeInfo && (
                <div
                  className='h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold border border-primary/20 flex-shrink-0'
                  title={assigneeInfo.display_name || assigneeInfo.email}
                >
                  {getInitials(assigneeInfo.display_name || assigneeInfo.email)}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
