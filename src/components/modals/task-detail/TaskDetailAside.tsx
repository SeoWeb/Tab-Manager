'use client';

import { ArrowUp, Calendar, Plus, Tag, User, X } from 'lucide-react';
import { useState } from 'react';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import type { CloudMember, CloudAccount } from '@/lib/cloudflareSync/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MetadataItem } from '@/components/modals/task-detail/MetadataItem';
import {
  priorityConfig,
  statusConfig,
} from '@/components/modals/task-detail/priorityConfig';

interface TaskDetailAsideProps {
  task: AdvancedTask;
  project: { cloudEnabled?: boolean } | undefined;
  members: CloudMember[];
  currentUser: CloudAccount | null;
  assignedMember: CloudMember | null;
  parentTask: AdvancedTask | null;
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onView: (task: AdvancedTask) => void;
}

export function TaskDetailAside({
  task,
  project,
  members,
  currentUser,
  assignedMember,
  parentTask,
  onUpdate,
  onView,
}: TaskDetailAsideProps) {
  const [newTag, setNewTag] = useState('');

  const handleAddTag = () => {
    if (newTag.trim() && task && !task.tags.includes(newTag.trim())) {
      const updatedTags = [...task.tags, newTag.trim()];
      onUpdate(task.id, { tags: updatedTags });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updatedTags = task.tags.filter((tag) => tag !== tagToRemove);
    onUpdate(task.id, { tags: updatedTags });
  };

  const CurrentStatusIcon = statusConfig[task.status].icon;

  return (
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
                  onUpdate(task.id, { status: statusKey as TaskStatus })
                }
              >
                <config.icon className={cn('h-4 w-4 mr-2', config.color)} />
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
                    onClick={() => onUpdate(task.id, { assignee: undefined })}
                  >
                    <span className='text-muted-foreground'>Unassigned</span>
                  </DropdownMenuItem>
                  {members.map((member) => (
                    <DropdownMenuItem
                      key={member.user_id}
                      onClick={() =>
                        onUpdate(task.id, { assignee: member.user_id })
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
                onClick={() => onUpdate(task.id, { assignee: currentUser.id })}
              >
                Assign to me
              </Button>
            )}
          </div>
        </MetadataItem>
      )}

      <MetadataItem icon={priorityConfig[task.priority].icon} label='Priority'>
        <span className={priorityConfig[task.priority].color}>
          {priorityConfig[task.priority].label}
        </span>
      </MetadataItem>

      <MetadataItem icon={Calendar} label='Due Date'>
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Not set'}
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
        <h4 className='text-sm font-medium text-muted-foreground mb-2'>Tags</h4>
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
  );
}
