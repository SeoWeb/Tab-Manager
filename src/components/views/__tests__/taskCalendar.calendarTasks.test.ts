import { startOfDay } from 'date-fns';
import {
  AGENDA_WINDOW_DAYS,
  TASK_DND_MIME,
  WEEK_STARTS_ON,
  dayKey,
  getAgendaDayGroups,
  getWeekDays,
  groupTasksByDay,
  isVisibleCalendarTask,
  visibleCalendarTasks,
} from '@/components/views/task-calendar/calendarTasks';
import { APRIL, MARCH, makeTask } from './calendarTestUtils';

describe('calendarTasks', () => {
  describe('isVisibleCalendarTask (legacy filter parity)', () => {
    it('keeps non-archived tasks with a due date', () => {
      const task = makeTask({ dueDate: MARCH(10) });
      expect(isVisibleCalendarTask(task)).toBe(true);
      expect(visibleCalendarTasks([task])).toEqual([task]);
    });

    it('drops tasks archived by flag, by status, or without a due date', () => {
      expect(
        isVisibleCalendarTask(
          makeTask({ isArchived: true, dueDate: MARCH(10) })
        )
      ).toBe(false);
      expect(
        isVisibleCalendarTask(
          makeTask({ status: 'archived', dueDate: MARCH(10) })
        )
      ).toBe(false);
      expect(isVisibleCalendarTask(makeTask({ dueDate: undefined }))).toBe(
        false
      );
      expect(visibleCalendarTasks([])).toEqual([]);
    });

    it('preserves the input order', () => {
      const a = makeTask({ dueDate: MARCH(10) });
      const b = makeTask({ dueDate: MARCH(11) });
      expect(visibleCalendarTasks([b, a])).toEqual([b, a]);
    });
  });

  describe('groupTasksByDay', () => {
    it('buckets tasks by the day of their due date, ignoring the time', () => {
      const morning = makeTask({ dueDate: MARCH(10, 9) });
      const evening = makeTask({ dueDate: MARCH(10, 23) });
      const otherDay = makeTask({ dueDate: MARCH(11) });

      const byDay = groupTasksByDay([morning, evening, otherDay]);

      expect(byDay.size).toBe(2);
      expect(byDay.get(dayKey(MARCH(10)))).toEqual([morning, evening]);
      expect(byDay.get(dayKey(MARCH(11)))).toEqual([otherDay]);
    });

    it('keys buckets on local midnight of the due date', () => {
      const task = makeTask({ dueDate: MARCH(10, 15) });
      const byDay = groupTasksByDay([task]);
      expect(byDay.has(startOfDay(MARCH(10)).getTime())).toBe(true);
    });

    it('ignores undated tasks and returns an empty map for empty input', () => {
      expect(groupTasksByDay([makeTask({ dueDate: undefined })])).toEqual(
        new Map()
      );
      expect(groupTasksByDay([])).toEqual(new Map());
    });
  });

  describe('getWeekDays', () => {
    it('returns the seven days of the week containing the anchor, Sunday-first', () => {
      // 2026-03-15 is a Sunday, so the week is Mar 15 – Mar 21.
      const days = getWeekDays(MARCH(15, 12));
      expect(days).toHaveLength(7);
      expect(days[0].toDateString()).toBe(MARCH(15, 0).toDateString());
      expect(days[6].toDateString()).toBe(MARCH(21, 0).toDateString());
    });

    it('rolls back to the Sunday before mid-week anchors', () => {
      // 2026-03-18 is a Wednesday.
      const days = getWeekDays(MARCH(18, 12));
      expect(days[0].toDateString()).toBe(MARCH(15, 0).toDateString());
      expect(days[6].toDateString()).toBe(MARCH(21, 0).toDateString());
    });

    it('honours a custom weekStartsOn', () => {
      const days = getWeekDays(MARCH(18, 12), 1); // Monday-first
      expect(days[0].toDateString()).toBe(MARCH(16, 0).toDateString());
    });

    it('uses the shared Sunday-first default', () => {
      expect(WEEK_STARTS_ON).toBe(0);
    });
  });

  describe('getAgendaDayGroups', () => {
    it('spans a 30-day window starting at (and including) the anchor day', () => {
      expect(AGENDA_WINDOW_DAYS).toBe(30);
      // Anchor 2026-03-15 → window Mar 15 … Apr 13 (29 days later).
      const byDay = groupTasksByDay([
        makeTask({ dueDate: MARCH(15, 9) }),
        makeTask({ dueDate: APRIL(13, 18) }),
      ]);
      const groups = getAgendaDayGroups(byDay, MARCH(15, 12));
      expect(groups).toHaveLength(2);
      expect(groups[0].date.toDateString()).toBe(MARCH(15, 0).toDateString());
      expect(groups[1].date.toDateString()).toBe(APRIL(13, 0).toDateString());
    });

    it('groups ascending by day and keeps the input order inside a day', () => {
      const first = makeTask({ title: 'First', dueDate: MARCH(16, 8) });
      const second = makeTask({ title: 'Second', dueDate: MARCH(16, 20) });
      const earlier = makeTask({ title: 'Earlier', dueDate: MARCH(15) });
      const byDay = groupTasksByDay([first, second, earlier]);

      const groups = getAgendaDayGroups(byDay, MARCH(15, 12));

      expect(groups.map((group) => group.date.getDate())).toEqual([15, 16]);
      expect(groups[0].tasks).toEqual([earlier]);
      expect(groups[1].tasks).toEqual([first, second]);
    });

    it('drops tasks outside the window and days without tasks', () => {
      const byDay = groupTasksByDay([
        makeTask({ title: 'Day before', dueDate: MARCH(14) }),
        makeTask({ title: 'Mid window', dueDate: MARCH(20) }),
        makeTask({ title: 'Day after', dueDate: APRIL(14) }),
      ]);

      const groups = getAgendaDayGroups(byDay, MARCH(15, 12));

      expect(groups).toHaveLength(1);
      expect(groups[0].tasks.map((task) => task.title)).toEqual(['Mid window']);
    });

    it('returns an empty list when no task falls in the window', () => {
      const byDay = groupTasksByDay([makeTask({ dueDate: MARCH(14) })]);
      expect(getAgendaDayGroups(byDay, MARCH(15, 12))).toEqual([]);
      expect(getAgendaDayGroups(new Map(), MARCH(15, 12))).toEqual([]);
    });
  });

  it('exports the drag payload MIME type', () => {
    expect(TASK_DND_MIME).toBe('application/x-task-id');
  });
});
