import type { AdvancedTask } from '@/types/tasks';

/** The three layouts the reworked calendar supports. */
export type CalendarViewMode = 'month' | 'week' | 'agenda';

export interface TaskCalendarViewProps {
  tasks: AdvancedTask[];
  onViewTask: (task: AdvancedTask) => void;
  /**
   * Overrides the store action used to persist a drag-to-reschedule drop.
   * Defaults to `updateTask(taskId, { dueDate: newDate })` from the app
   * store, so the view keeps working when embedded with the legacy prop set
   * (`tasks` + `onViewTask`) only.
   */
  onRescheduleTask?: (taskId: string, newDate: Date) => void;
}
