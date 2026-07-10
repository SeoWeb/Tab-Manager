'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { fetchProjectMembers } from '@/lib/cloudflareSync';
import type { CloudMember, CloudAccount } from '@/lib/cloudflareSync/types';
import { marked } from 'marked';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import {
  Calendar,
  Tag,
  Flag,
  CheckCircle2,
  Circle,
  AlertCircle,
  Timer,
  Zap,
  MessageSquare,
  List,
  Pencil,
  GripVertical,
  Plus,
  ArrowUp,
  X,
  Archive,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '../ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '../ui/input';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: AdvancedTask | null;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
}

const priorityConfig = {
  low: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    icon: Circle,
    label: 'Low',
  },
  medium: {
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50',
    icon: AlertCircle,
    label: 'Medium',
  },
  high: {
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    icon: Flag,
    label: 'High',
  },
  urgent: {
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    icon: Zap,
    label: 'Urgent',
  },
};

const statusConfig: Record<
  TaskStatus,
  { color: string; bgColor: string; icon: React.ElementType; label: string }
> = {
  todo: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Circle,
    label: 'To Do',
  },
  'in-progress': {
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
    icon: Timer,
    label: 'In Progress',
  },
  blocked: {
    color: 'text-red-500',
    bgColor: 'bg-red-100',
    icon: AlertCircle,
    label: 'Blocked',
  },
  completed: {
    color: 'text-green-500',
    bgColor: 'bg-green-100',
    icon: CheckCircle2,
    label: 'Completed',
  },
  cancelled: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Circle,
    label: 'Cancelled',
  },
  archived: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Archive,
    label: 'Archived',
  },
};

const MetadataItem = ({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) => (
  <div className='flex items-start gap-3'>
    <Icon className='h-5 w-5 text-muted-foreground mt-1' />
    <div>
      <div className='text-sm font-medium text-muted-foreground'>{label}</div>
      <div className='text-sm font-semibold'>{children}</div>
    </div>
  </div>
);

export default function TaskDetailModal({
  isOpen,
  onClose,
  task,
  onEdit,
  onView,
}: TaskDetailModalProps) {
  const tasks = useAppStoreWithDefaults((state) => state.tasks, []);
  const addTaskComment = useAppStoreWithDefaults(
    (state) => state.addTaskComment,
    () => {}
  );
  const updateTask = useAppStoreWithDefaults(
    (state) => state.updateTask,
    () => {}
  );
  const addSubtask = useAppStoreWithDefaults(
    (state) => state.addSubtask,
    () => {}
  );
  const [newComment, setNewComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [newTag, setNewTag] = useState('');

  const projects = useAppStoreWithDefaults((state) => state.projects, []);
  const project = projects.find((p) => p.id === task?.projectId);
  const cloudSync = useAppStoreWithDefaults((state) => state.cloudSync, {
    enabled: false,
    status: 'idle' as const,
    lastSyncedAt: null,
    lastError: null,
    pendingMutationCount: 0,
    account: null as CloudAccount | null,
    apiBaseUrl: '',
    cursors: {},
    realtimeConnected: false,
    onlinePresence: [],
    pendingEdits: {},
  });
  const currentUser = cloudSync.account;
  const [members, setMembers] = useState<CloudMember[]>([]);

  useEffect(() => {
    if (task?.projectId && project?.cloudEnabled && cloudSync.enabled) {
      fetchProjectMembers(task.projectId)
        .then(setMembers)
        .catch((err) => console.error('Failed to fetch project members', err));
    } else {
      setMembers([]);
    }
  }, [task?.projectId, project?.cloudEnabled, cloudSync.enabled]);

  const assignedMember = useMemo(() => {
    if (!task?.assignee) return null;
    return members.find((m) => m.user_id === task.assignee) || null;
  }, [task?.assignee, members]);

  const subtasks = useMemo(
    () =>
      task
        ? task.subtasks
            .map((subtaskId) => tasks.find((t) => t.id === subtaskId))
            .filter((t): t is AdvancedTask => !!t)
        : [],
    [task, tasks]
  );

  const parentTask = useMemo(
    () =>
      task && task.parentTaskId
        ? tasks.find((t) => t.id === task.parentTaskId)
        : null,
    [task, tasks]
  );

  const descriptionHtml = useMemo(() => {
    if (!task?.description) return '';
    try {
      return marked(task.description, { async: false });
    } catch (e) {
      console.error('Failed to parse markdown:', e);
      return task.description;
    }
  }, [task?.description]);

  if (!task) return null;

  const handleAddComment = () => {
    if (newComment.trim() && task) {
      addTaskComment(task.id, newComment.trim(), 'User');
      setNewComment('');
    }
  };

  const handleAddSubtask = () => {
    if (newSubtask.trim() && task) {
      const subtaskData: Omit<
        AdvancedTask,
        'id' | 'createdAt' | 'updatedAt' | 'activities' | 'parentTaskId'
      > = {
        title: newSubtask.trim(),
        status: 'todo',
        priority: task.priority,
        category: task.category,
        projectId: task.projectId,
        tags: [],
        subtasks: [],
        attachments: [],
        notes: '',
        reminders: [],
        progress: 0,
        comments: [],
        isArchived: false,
        isFavorite: false,
        customFields: {},
      };
      addSubtask(task.id, subtaskData);
      setNewSubtask('');
    }
  };

  const handleSubtaskStatusChange = (subtaskId: string, status: TaskStatus) => {
    updateTask(subtaskId, { status });
  };

  const handleStatusChange = (newStatus: TaskStatus) => {
    updateTask(task.id, { status: newStatus });
  };

  const handleAddTag = () => {
    if (newTag.trim() && task && !task.tags.includes(newTag.trim())) {
      const updatedTags = [...task.tags, newTag.trim()];
      updateTask(task.id, { tags: updatedTags });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (task) {
      const updatedTags = task.tags.filter((tag) => tag !== tagToRemove);
      updateTask(task.id, { tags: updatedTags });
    }
  };

  const handleEditClick = () => {
    onEdit(task);
    onClose();
  };

  const handleArchive = () => {
    if (task) {
      updateTask(task.id, { isArchived: true });
      onClose();
    }
  };

  const CurrentStatusIcon = statusConfig[task.status].icon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='w-[92vw] sm:max-w-4xl h-[90vh] flex flex-col p-0'>
        <DialogHeader className='p-4 border-b flex flex-row justify-between items-center'>
          <DialogTitle className='flex items-center gap-2'>
            <span>{task.title}</span>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6'
              onClick={handleEditClick}
            >
              <Pencil className='h-4 w-4' />
            </Button>
          </DialogTitle>
          {task.status === 'completed' && (
            <Button variant='outline' size='sm' onClick={handleArchive}>
              <Archive className='h-4 w-4 mr-2' />
              Archive
            </Button>
          )}
        </DialogHeader>
        <div className='flex-1 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-3 gap-0'>
          <div className='p-4 md:p-6 md:col-span-2 md:h-full md:overflow-y-auto space-y-6'>
            <div>
              <h3 className='font-semibold mb-2'>Description</h3>
              {task.description ? (
                <div
                  className='text-sm text-muted-foreground markdown-content'
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
              ) : (
                <p className='text-sm text-muted-foreground italic'>
                  No description provided.
                </p>
              )}
            </div>

            <Separator />

            <div>
              <h3 className='font-semibold mb-3 flex items-center gap-2'>
                <List className='h-5 w-5' />
                Subtasks
              </h3>
              <div className='space-y-2'>
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className='flex items-center gap-3 p-2 hover:bg-secondary/50 rounded-md transition-colors group'
                  >
                    <GripVertical className='h-4 w-4 text-muted-foreground' />
                    <button
                      onClick={() =>
                        handleSubtaskStatusChange(
                          subtask.id,
                          subtask.status === 'completed' ? 'todo' : 'completed'
                        )
                      }
                      className='flex-shrink-0'
                    >
                      <CheckCircle2
                        className={cn(
                          'h-5 w-5',
                          subtask.status === 'completed'
                            ? 'text-green-500'
                            : 'text-muted-foreground/50'
                        )}
                      />
                    </button>
                    <button
                      className='flex-1 text-left'
                      onClick={() => onView(subtask)}
                    >
                      <span
                        className={cn(
                          'text-sm group-hover:underline',
                          subtask.status === 'completed' &&
                            'line-through text-muted-foreground'
                        )}
                      >
                        {subtask.title}
                      </span>
                    </button>
                  </div>
                ))}
                <div className='flex items-center gap-2'>
                  <Input
                    placeholder='Add a new subtask...'
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddSubtask()}
                    className='flex-1'
                  />
                  <Button onClick={handleAddSubtask} size='icon'>
                    <Plus className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className='font-semibold mb-3 flex items-center gap-2'>
                <MessageSquare className='h-5 w-5' />
                Comments
              </h3>
              <div className='space-y-4'>
                <div className='flex gap-3'>
                  <Textarea
                    placeholder='Add a comment...'
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={2}
                    className='mb-2'
                  />
                  <Button onClick={handleAddComment} size='sm'>
                    Comment
                  </Button>
                </div>
                {task.comments.length > 0 ? (
                  task.comments
                    .slice()
                    .reverse()
                    .map((comment) => (
                      <div key={comment.id} className='text-sm'>
                        <p className='text-muted-foreground whitespace-pre-wrap'>
                          {comment.content}
                        </p>
                        <div className='text-xs text-muted-foreground'>
                          {new Date(comment.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))
                ) : (
                  <p className='text-sm text-muted-foreground text-center py-4'>
                    No comments yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          <aside className='p-4 md:p-6 bg-secondary/30 border-t md:border-t-0 md:border-l md:col-span-1 md:h-full md:overflow-y-auto space-y-6'>
            <MetadataItem icon={CurrentStatusIcon} label='Status'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    className={cn(
                      'text-sm font-semibold -ml-2',
                      statusConfig[task.status].color
                    )}
                  >
                    {statusConfig[task.status].label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {Object.entries(statusConfig).map(([statusKey, config]) => (
                    <DropdownMenuItem
                      key={statusKey}
                      onClick={() =>
                        handleStatusChange(statusKey as TaskStatus)
                      }
                    >
                      <config.icon
                        className={cn('h-4 w-4 mr-2', config.color)}
                      />
                      <span>{config.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </MetadataItem>

            {project?.cloudEnabled && (
              <MetadataItem icon={User} label='Assignee'>
                <div className='flex flex-col gap-1.5'>
                  <div className='flex items-center gap-2'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          className='text-sm font-semibold -ml-2 h-auto py-1 px-2 hover:bg-muted'
                        >
                          {assignedMember ? (
                            assignedMember.display_name || assignedMember.email
                          ) : (
                            <span className='text-muted-foreground font-normal'>
                              Unassigned
                            </span>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className='max-h-60 overflow-y-auto'>
                        <DropdownMenuItem
                          onClick={() =>
                            updateTask(task.id, { assignee: undefined })
                          }
                        >
                          <span className='text-muted-foreground'>
                            Unassigned
                          </span>
                        </DropdownMenuItem>
                        {members.map((member) => (
                          <DropdownMenuItem
                            key={member.user_id}
                            onClick={() =>
                              updateTask(task.id, {
                                assignee: member.user_id,
                              })
                            }
                          >
                            <span>{member.display_name || member.email}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {currentUser && task.assignee !== currentUser.id && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-7 text-xs w-fit'
                      onClick={() =>
                        updateTask(task.id, { assignee: currentUser.id })
                      }
                    >
                      Assign to me
                    </Button>
                  )}
                </div>
              </MetadataItem>
            )}

            <MetadataItem
              icon={priorityConfig[task.priority].icon}
              label='Priority'
            >
              <span className={priorityConfig[task.priority].color}>
                {priorityConfig[task.priority].label}
              </span>
            </MetadataItem>

            <MetadataItem icon={Calendar} label='Due Date'>
              {task.dueDate
                ? new Date(task.dueDate).toLocaleDateString()
                : 'Not set'}
            </MetadataItem>

            <MetadataItem icon={Tag} label='Category'>
              {task.category}
            </MetadataItem>

            {parentTask && (
              <MetadataItem icon={ArrowUp} label='Parent Task'>
                <a
                  href='#'
                  onClick={(e) => {
                    e.preventDefault();
                    onView(parentTask);
                  }}
                  className='hover:underline'
                >
                  {parentTask.title}
                </a>
              </MetadataItem>
            )}

            <div>
              <h4 className='text-sm font-medium text-muted-foreground mb-2'>
                Tags
              </h4>
              <div className='flex flex-wrap gap-2'>
                {task.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant='secondary'
                    className='flex items-center gap-1'
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className='rounded-full hover:bg-muted-foreground/20 p-0.5'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className='flex items-center gap-2 mt-2'>
                <Input
                  placeholder='Add a tag...'
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                  className='h-8'
                />
                <Button onClick={handleAddTag} size='icon' className='h-8 w-8'>
                  <Plus className='h-4 w-4' />
                </Button>
              </div>
              {task.tags.length === 0 && (
                <p className='text-xs text-muted-foreground mt-2'>No tags.</p>
              )}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
