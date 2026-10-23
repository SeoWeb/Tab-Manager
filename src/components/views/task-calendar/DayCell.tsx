'use client';

import React from 'react';
import { format, isToday, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AdvancedTask } from '@/types/tasks';
import { TASK_DND_MIME } from './calendarTasks';

interface TaskChipProps {
  task: AdvancedTask;
  onTaskClick: (task: AdvancedTask) => void;
}

/**
 * Priority → chip palette. Every entry pairs a light token with an explicit
 * `dark:` variant; the tokens themselves are CSS-variable driven so the
 * `.dark` root class swaps them automatically (Tailwind `darkMode: 'class'`).
 */
const PRIORITY_CHIP_CLASSES: Record<AdvancedTask['priority'], string> = {
  urgent: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  high: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  medium: 'bg-primary/10 text-primary dark:bg-primary/20',
  low: 'bg-muted text-muted-foreground dark:bg-muted/50',
};

/**
 * A draggable, clickable task chip. Uses plain HTML5 drag events (not the
 * app-wide dnd-kit context): the calendar is the only drag source/target
 * involved and dropping reschedules the task's due date.
 */
export function TaskChip({ task, onTaskClick }: TaskChipProps) {
  const isCompleted = task.status === 'completed';
  return (
    <div
      role='button'
      tabIndex={0}
      draggable
      data-testid='task-chip'
      data-task-id={task.id}
      title={task.title}
      onClick={(event) => {
        event.stopPropagation();
        onTaskClick(task);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTaskClick(task);
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_DND_MIME, task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'cursor-grab truncate rounded px-1.5 py-0.5 text-left text-xs font-medium',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        PRIORITY_CHIP_CLASSES[task.priority],
        isCompleted && 'line-through opacity-60'
      )}
    >
      {task.title}
    </div>
  );
}

interface DayCellProps {
  date: Date;
  tasks: AdvancedTask[];
  onTaskClick: (task: AdvancedTask) => void;
  onRescheduleTask: (taskId: string, newDate: Date) => void;
  /** Day belongs to the adjacent month (month-grid outside days). */
  isOutside?: boolean;
  /**
   * Cap on the chips rendered per cell (month grid keeps rows short).
   * Extra tasks collapse into a non-interactive "+N more" hint whose
   * `title` lists their names. Omit to render every chip (week strip).
   */
  maxChips?: number;
}

/**
 * One day cell: the date number plus that day's task chips, and the drop
 * target for drag-to-reschedule. Shared by the month grid (via DayPicker's
 * DayContent) and the week strip.
 */
export function DayCell({
  date,
  tasks,
  onTaskClick,
  onRescheduleTask,
  isOutside = false,
  maxChips,
}: DayCellProps) {
  const today = isToday(date);
  const shownTasks = maxChips === undefined ? tasks : tasks.slice(0, maxChips);
  const hiddenTasks = maxChips === undefined ? [] : tasks.slice(maxChips);
  return (
    <div
      data-testid='calendar-day'
      data-date={format(date, 'yyyy-MM-dd')}
      data-today={today ? 'true' : undefined}
      data-outside={isOutside ? 'true' : undefined}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData(TASK_DND_MIME);
        if (taskId) onRescheduleTask(taskId, startOfDay(date));
      }}
      className={cn(
        'flex h-full min-h-20 flex-col gap-1 p-1',
        today && 'bg-primary/5 dark:bg-primary/10'
      )}
    >
      <div className='flex items-center justify-end px-1'>
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs',
            today
              ? 'bg-primary font-semibold text-primary-foreground'
              : 'text-muted-foreground'
          )}
        >
          {format(date, 'd')}
        </span>
      </div>
      {tasks.length > 0 && (
        <ul className='flex flex-col gap-0.5'>
          {shownTasks.map((task) => (
            <li key={task.id}>
              <TaskChip task={task} onTaskClick={onTaskClick} />
            </li>
          ))}
          {hiddenTasks.length > 0 && (
            <li
              data-testid='calendar-day-more'
              title={hiddenTasks.map((task) => task.title).join(', ')}
              className='px-1.5 text-[10px] text-muted-foreground'
            >
              +{hiddenTasks.length} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
