'use client';

import { GripVertical, List, Plus, CheckCircle2 } from 'lucide-react';
import type { AdvancedTask } from '@/types/tasks';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SubtasksSectionProps {
  subtasks: AdvancedTask[];
  newSubtask: string;
  onNewSubtaskChange: (value: string) => void;
  onAddSubtask: () => void;
  onSubtaskStatusChange: (
    subtaskId: string,
    status: AdvancedTask['status']
  ) => void;
  onView: (task: AdvancedTask) => void;
}

export function SubtasksSection({
  subtasks,
  newSubtask,
  onNewSubtaskChange,
  onAddSubtask,
  onSubtaskStatusChange,
  onView,
}: SubtasksSectionProps) {
  return (
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
                onSubtaskStatusChange(
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
            onChange={(e) => onNewSubtaskChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onAddSubtask()}
            className='flex-1'
          />
          <Button onClick={onAddSubtask} size='icon'>
            <Plus className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </div>
  );
}
