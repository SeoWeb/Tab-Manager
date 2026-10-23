'use client';

import React, { useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { addDays, addMonths, format, startOfDay, startOfMonth } from 'date-fns';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import type { AdvancedTask } from '@/types/tasks';
import { CalendarToolbar } from './CalendarToolbar';
import { DayCell, TaskChip } from './DayCell';
import {
  AGENDA_WINDOW_DAYS,
  WEEK_STARTS_ON,
  dayKey,
  getAgendaDayGroups,
  getWeekDays,
  groupTasksByDay,
  visibleCalendarTasks,
} from './calendarTasks';
import type { CalendarViewMode, TaskCalendarViewProps } from './types';

const EMPTY_TASKS: AdvancedTask[] = [];

/** Month cells cap their chip list so busy days cannot stretch the grid. */
const MONTH_MAX_CHIPS = 3;

/**
 * The react-day-picker rework of TaskCalendarView (cleanup-and-regression-tests
 * §1.2). DayPicker supplies the month grid; the per-day task chips, the week
 * strip, the agenda list, drag-to-reschedule and the toolbar are this
 * module's own rendering, styled with the app's semantic Tailwind tokens so
 * `.dark` theming applies.
 *
 * Parity with the pre-rework calendar view:
 * - same tasks (filter in `calendarTasks.ts` is copied 1:1 from the legacy
 *   event mapping) rendered per due-date day;
 * - month + week navigation via the toolbar, plus the agenda list restored
 *   from the legacy view: a rolling 30-day window grouped by due day;
 * - clicking a task still calls `onViewTask`;
 * - drag-to-reschedule is new: dropping a chip on a day persists
 *   `updateTask(id, { dueDate })`.
 */
const TaskCalendarModern: React.FC<TaskCalendarViewProps> = ({
  tasks,
  onViewTask,
  onRescheduleTask,
}) => {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  // The anchor day: month mode shows the month containing it, week mode the
  // week containing it, agenda mode the 30-day window starting at it. Always
  // a local midnight.
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const updateTask = useAppStoreWithDefaults((state) => state.updateTask);

  const rescheduleTask =
    onRescheduleTask ??
    ((taskId: string, newDate: Date) =>
      updateTask(taskId, { dueDate: newDate }));

  const tasksByDay = useMemo(
    () => groupTasksByDay(visibleCalendarTasks(tasks)),
    [tasks]
  );
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const agendaGroups = useMemo(
    () => getAgendaDayGroups(tasksByDay, anchor),
    [tasksByDay, anchor]
  );

  const navigate = (direction: 1 | -1) => {
    setAnchor((current) => {
      if (viewMode === 'month') {
        return addMonths(startOfMonth(current), direction);
      }
      if (viewMode === 'week') {
        return addDays(current, 7 * direction);
      }
      // Agenda pages a full 30-day window at a time.
      return addDays(current, AGENDA_WINDOW_DAYS * direction);
    });
  };
  const goToToday = () => setAnchor(startOfDay(new Date()));

  const renderDayCell = (date: Date, isOutside: boolean, maxChips?: number) => (
    <DayCell
      date={date}
      isOutside={isOutside}
      tasks={tasksByDay.get(dayKey(date)) ?? EMPTY_TASKS}
      onTaskClick={onViewTask}
      onRescheduleTask={rescheduleTask}
      maxChips={maxChips}
    />
  );

  const rangeLabel = (start: Date, end: Date) =>
    `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;

  let label: string;
  if (viewMode === 'month') {
    label = format(anchor, 'MMMM yyyy');
  } else if (viewMode === 'week') {
    label = rangeLabel(weekDays[0], weekDays[6]);
  } else {
    label = rangeLabel(anchor, addDays(anchor, AGENDA_WINDOW_DAYS - 1));
  }

  return (
    <div
      data-testid='calendar-root'
      className='flex h-full flex-col bg-background text-foreground'
    >
      <CalendarToolbar
        viewMode={viewMode}
        label={label}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={goToToday}
        onViewModeChange={setViewMode}
      />
      {viewMode === 'week' && (
        <div
          data-testid='calendar-grid-week'
          className='grid flex-1 grid-cols-7 gap-px border border-border bg-border'
        >
          {weekDays.map((date) => (
            <div key={format(date, 'yyyy-MM-dd')} className='bg-card'>
              {renderDayCell(date, false)}
            </div>
          ))}
        </div>
      )}
      {viewMode === 'agenda' && (
        <div
          data-testid='calendar-grid-agenda'
          className='flex-1 overflow-auto'
        >
          {agendaGroups.length === 0 ? (
            <p
              data-testid='agenda-empty'
              className='p-8 text-center text-sm text-muted-foreground'
            >
              No tasks due in this period.
            </p>
          ) : (
            agendaGroups.map(({ date, tasks }) => (
              <section key={format(date, 'yyyy-MM-dd')}>
                <h3
                  data-testid='agenda-day'
                  data-date={format(date, 'yyyy-MM-dd')}
                  className='sticky top-0 z-10 border-b border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground'
                >
                  {format(date, 'EEE, MMM d, yyyy')}
                </h3>
                <ul className='flex flex-col gap-0.5 px-2 py-1.5'>
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <TaskChip task={task} onTaskClick={onViewTask} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
      {viewMode === 'month' && (
        <div data-testid='calendar-grid-month' className='flex-1 overflow-auto'>
          <DayPicker
            month={startOfMonth(anchor)}
            onMonthChange={(month) => setAnchor(startOfDay(month))}
            weekStartsOn={WEEK_STARTS_ON}
            showOutsideDays
            // DayPicker ships no styles here (the app's shadcn `ui/calendar`
            // wrapper relies on the same trick): the Tailwind classes below
            // carry all visuals, including the dark-mode tokens.
            classNames={{
              months: 'w-full',
              month: 'w-full',
              table: 'w-full border-collapse',
              head_row: 'grid grid-cols-7 border-b border-border',
              head_cell:
                'px-1 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground',
              row: 'grid grid-cols-7',
              cell: 'min-h-20 w-full border border-border p-0 align-top',
              day: 'h-full w-full p-0 text-left font-normal',
              day_outside: 'text-muted-foreground/60',
              day_today: '',
              day_hidden: 'invisible',
            }}
            components={{
              // The toolbar above owns navigation and the range label, so
              // drop DayPicker's built-in caption (which contains the
              // month label and its own prev/next buttons).
              Caption: () => null,
              DayContent: ({ date, activeModifiers }) =>
                renderDayCell(
                  date,
                  Boolean(activeModifiers.outside),
                  MONTH_MAX_CHIPS
                ),
            }}
          />
        </div>
      )}
    </div>
  );
};

export default TaskCalendarModern;
