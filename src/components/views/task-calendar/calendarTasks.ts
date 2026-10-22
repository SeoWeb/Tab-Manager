import { addDays, startOfDay, startOfWeek } from 'date-fns';
import type { Day } from 'date-fns';
import type { AdvancedTask } from '@/types/tasks';

/**
 * MIME type used for the calendar's HTML5 drag-to-reschedule payload. The
 * dragged task chip writes its id under this key; the day cells read it back
 * on drop.
 */
export const TASK_DND_MIME = 'application/x-task-id';

/** Sunday-first weeks, matching the pre-rework calendar's month grid. */
export const WEEK_STARTS_ON: Day = 0;

/**
 * Predicate copied 1:1 from the pre-rework calendar's event mapping so
 * the reworked view shows exactly the same set of tasks: not archived (by
 * flag or by status) and carrying a due date.
 */
export function isVisibleCalendarTask(task: AdvancedTask): boolean {
  return Boolean(
    !task.isArchived && task.status !== 'archived' && task.dueDate
  );
}

export function visibleCalendarTasks(tasks: AdvancedTask[]): AdvancedTask[] {
  return tasks.filter(isVisibleCalendarTask);
}

/**
 * `dueDate` is typed `Date` but can arrive as an ISO string after persist
 * rehydration; the legacy view coerced it through `new Date(...)` for the
 * same reason.
 */
export function toDueDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Bucket key for a day: the epoch ms of its local midnight. */
export function dayKey(date: Date | string): number {
  return startOfDay(toDueDate(date)).getTime();
}

/**
 * Groups visible tasks by the day of their due date. Order inside a day
 * bucket follows the input array order (the legacy view gave no stronger
 * ordering guarantee for same-day all-day events).
 */
export function groupTasksByDay(
  tasks: AdvancedTask[]
): Map<number, AdvancedTask[]> {
  const byDay = new Map<number, AdvancedTask[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = dayKey(task.dueDate);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(task);
    } else {
      byDay.set(key, [task]);
    }
  }
  return byDay;
}

/** The seven days (starting `weekStartsOn`) of the week containing `anchor`. */
export function getWeekDays(
  anchor: Date,
  weekStartsOn: Day = WEEK_STARTS_ON
): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn });
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
