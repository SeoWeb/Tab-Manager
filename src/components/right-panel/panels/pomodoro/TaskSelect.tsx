'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings } from 'lucide-react';
import type { AdvancedTask } from '@/types/tasks';

interface TaskSelectProps {
  activeTask: AdvancedTask | null;
  availableTasks: AdvancedTask[];
  selectedDuration: number;
  timerState: 'idle' | 'running' | 'paused' | 'break';
  onSetActiveTask: (taskId: string | null) => void;
  onDurationChange: (duration: number) => void;
}

export function TaskSelect({
  activeTask,
  availableTasks,
  selectedDuration,
  timerState,
  onSetActiveTask,
  onDurationChange,
}: TaskSelectProps) {
  return (
    <>
      {/* Task Selection */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>Select Task</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <Select value={activeTask?.id || ''} onValueChange={onSetActiveTask}>
            <SelectTrigger className='text-sm'>
              <SelectValue placeholder='Choose a task to focus on...' />
            </SelectTrigger>
            <SelectContent>
              {availableTasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  <div className='flex items-center gap-2'>
                    <span className='truncate'>{task.title}</span>
                    <Badge variant='outline' className='text-xs'>
                      {task.priority}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeTask && (
            <div className='p-2 bg-secondary/30 rounded-md'>
              <div className='text-sm font-medium'>{activeTask.title}</div>
              {activeTask.description && (
                <div className='text-xs text-muted-foreground mt-1 line-clamp-2'>
                  {activeTask.description}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timer Settings */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center gap-2'>
            <Settings className='h-4 w-4' />
            Timer Settings
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex items-center gap-2'>
            <Select
              value={selectedDuration.toString()}
              onValueChange={(value) => onDurationChange(parseInt(value))}
              disabled={timerState !== 'idle'}
            >
              <SelectTrigger className='text-sm'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='15'>15 minutes</SelectItem>
                <SelectItem value='25'>25 minutes (Classic)</SelectItem>
                <SelectItem value='30'>30 minutes</SelectItem>
                <SelectItem value='45'>45 minutes</SelectItem>
                <SelectItem value='60'>60 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
