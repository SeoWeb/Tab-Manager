/**
 * Parity checklist for the TaskCalendarView rework (cleanup-and-regression-tests
 * §1.2). The pre-rework calendar view provided: a month grid with
 * previous/today/next navigation and a Month/Week view switch, per-day task
 * lists built from tasks with a due date, click-to-view, and dark-mode
 * styling. These tests pin the react-day-picker rework to the same contract —
 * plus drag-to-reschedule, which the rework adds, the restored agenda list,
 * and the month grid's chip cap that keeps busy days from stretching rows.
 *
 * The suite pins the clock to Sunday 2026-03-15 so month/week/agenda
 * navigation has deterministic labels.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import TaskCalendarModern from '@/components/views/task-calendar/TaskCalendarModern';
import { TASK_DND_MIME } from '@/components/views/task-calendar/calendarTasks';
import type { TaskCalendarViewProps } from '@/components/views/task-calendar/types';
import type { AdvancedTask } from '@/types/tasks';
import TaskCalendarView from '@/components/views/TaskCalendarView';
import {
  APRIL,
  MARCH,
  createDataTransfer,
  makeTask,
} from './calendarTestUtils';

const mockOnViewTask = jest.fn();
const mockOnRescheduleTask = jest.fn();
const mockUpdateTask = jest.fn();

jest.mock('@/hooks/useAppStoreWithDefaults', () => ({
  __esModule: true,
  // The reworked calendar only pulls `updateTask` (for drag-to-reschedule).
  useAppStoreWithDefaults: (
    selector: (state: { updateTask: typeof mockUpdateTask }) => unknown
  ) => selector({ updateTask: mockUpdateTask }),
}));

// lucide-react is ESM-only and unparseable by jest (same as AppClient tests).
jest.mock('lucide-react', () => ({
  __esModule: true,
  ChevronLeft: () => null,
  ChevronRight: () => null,
}));

function renderModern(props: Partial<TaskCalendarViewProps> = {}) {
  return render(
    <TaskCalendarModern tasks={[]} onViewTask={mockOnViewTask} {...props} />
  );
}

/** Finds the day cell for an ISO date, e.g. `getCell('2026-03-10')`. */
function getCell(isoDate: string): HTMLElement {
  const cell = screen
    .getAllByTestId('calendar-day')
    .find((el) => el.getAttribute('data-date') === isoDate);
  expect(cell).toBeDefined();
  return cell as HTMLElement;
}

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(MARCH(15, 12)); // Sunday 2026-03-15, local noon
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TaskCalendarModern parity', () => {
  it('renders one task chip on the day cell of each visible task and applies the legacy visibility filter', () => {
    const due = makeTask({ title: 'Write spec', dueDate: MARCH(10, 9) });
    const dueToday = makeTask({ title: 'Review PR', dueDate: MARCH(15, 14) });
    renderModern({ tasks: [due, dueToday] });

    expect(within(getCell('2026-03-10')).getByText('Write spec')).toBeVisible();
    expect(within(getCell('2026-03-15')).getByText('Review PR')).toBeVisible();

    // Legacy filter parity: archived (flag or status) and undated tasks are
    // never rendered.
    renderModern({
      tasks: [
        makeTask({
          title: 'Flag-archived',
          isArchived: true,
          dueDate: MARCH(10),
        }),
        makeTask({
          title: 'Status-archived',
          status: 'archived',
          dueDate: MARCH(10),
        }),
        makeTask({ title: 'Undated' }),
      ],
    });
    expect(screen.queryByText('Flag-archived')).not.toBeInTheDocument();
    expect(screen.queryByText('Status-archived')).not.toBeInTheDocument();
    expect(screen.queryByText('Undated')).not.toBeInTheDocument();
  });

  it('navigates by month with prev/next and returns to the current month with Today', () => {
    renderModern();
    const label = screen.getByTestId('calendar-label');
    expect(label).toHaveTextContent('March 2026');

    fireEvent.click(screen.getByTestId('calendar-next'));
    expect(label).toHaveTextContent('April 2026');
    expect(getCell('2026-04-15')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('calendar-prev'));
    expect(label).toHaveTextContent('March 2026');
    fireEvent.click(screen.getByTestId('calendar-prev'));
    expect(label).toHaveTextContent('February 2026');

    fireEvent.click(screen.getByTestId('calendar-today'));
    expect(label).toHaveTextContent('March 2026');
  });

  it('navigates by week when the Week view is active', () => {
    renderModern();
    fireEvent.click(screen.getByTestId('calendar-view-week'));

    const weekGrid = screen.getByTestId('calendar-grid-week');
    expect(weekGrid).toBeInTheDocument();

    // 2026-03-15 is a Sunday → the week is Mar 15 – Mar 21.
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Mar 15 – Mar 21, 2026'
    );
    let cells = within(weekGrid).getAllByTestId('calendar-day');
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveAttribute('data-date', '2026-03-15');
    expect(cells[6]).toHaveAttribute('data-date', '2026-03-21');

    fireEvent.click(screen.getByTestId('calendar-next'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Mar 22 – Mar 28, 2026'
    );
    cells = within(weekGrid).getAllByTestId('calendar-day');
    expect(cells[0]).toHaveAttribute('data-date', '2026-03-22');

    fireEvent.click(screen.getByTestId('calendar-prev'));
    fireEvent.click(screen.getByTestId('calendar-view-month'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'March 2026'
    );
  });

  it('shows per-day task lists in the week view too', () => {
    renderModern({
      tasks: [makeTask({ title: 'Midweek thing', dueDate: MARCH(18, 10) })],
    });
    fireEvent.click(screen.getByTestId('calendar-view-week'));
    expect(
      within(getCell('2026-03-18')).getByText('Midweek thing')
    ).toBeVisible();
  });

  it('opens a task via onViewTask when its chip is clicked (legacy onSelectEvent parity)', () => {
    const task = makeTask({ title: 'Clickable', dueDate: MARCH(10) });
    renderModern({ tasks: [task] });

    fireEvent.click(screen.getByText('Clickable'));

    expect(mockOnViewTask).toHaveBeenCalledTimes(1);
    expect(mockOnViewTask).toHaveBeenCalledWith(task);
  });

  it('reschedules a task by dragging its chip onto another day (injected handler)', () => {
    const task = makeTask({ title: 'Draggable', dueDate: MARCH(10, 9) });
    renderModern({ tasks: [task], onRescheduleTask: mockOnRescheduleTask });

    const chip = screen.getByText('Draggable');
    const target = getCell('2026-03-17');
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    // The chip published its id under the shared MIME type…
    expect(dataTransfer.getData(TASK_DND_MIME)).toBe(task.id);
    // …and the drop invoked the reschedule handler with local midnight of
    // the target day.
    expect(mockOnRescheduleTask).toHaveBeenCalledTimes(1);
    expect(mockOnRescheduleTask).toHaveBeenCalledWith(
      task.id,
      new Date(2026, 2, 17)
    );
  });

  it('reschedules through the store updateTask action by default', () => {
    const task = makeTask({ title: 'Store drop', dueDate: MARCH(12) });
    renderModern({ tasks: [task] });

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByText('Store drop'), { dataTransfer });
    fireEvent.drop(getCell('2026-03-20'), { dataTransfer });

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    expect(mockUpdateTask).toHaveBeenCalledWith(task.id, {
      dueDate: new Date(2026, 2, 20),
    });
  });

  it('carries the dark-mode theme tokens (`.dark` CSS-variable classes)', () => {
    const tasks: AdvancedTask[] = [
      makeTask({
        title: 'Urgent thing',
        priority: 'urgent',
        dueDate: MARCH(10),
      }),
      makeTask({ title: 'Low thing', priority: 'low', dueDate: MARCH(10) }),
    ];
    renderModern({ tasks });

    // Root and toolbar use semantic tokens themed by the `.dark` variables.
    expect(screen.getByTestId('calendar-root')).toHaveClass(
      'bg-background',
      'text-foreground'
    );
    expect(screen.getByTestId('calendar-toolbar')).toHaveClass('border-border');

    // Chips pair light tokens with explicit dark: variants.
    expect(screen.getByText('Urgent thing')).toHaveClass(
      'bg-destructive/10',
      'dark:bg-destructive/20'
    );
    expect(screen.getByText('Low thing')).toHaveClass(
      'dark:bg-muted/50',
      'text-muted-foreground'
    );

    // Today's cell has an explicit dark: highlight too.
    expect(getCell('2026-03-15')).toHaveClass('dark:bg-primary/10');
  });

  it('renders a full month grid structurally (7 weekday headers, 35 day cells, today/outside markers)', () => {
    renderModern();
    const grid = screen.getByTestId('calendar-grid-month');

    const headers = within(grid)
      .getAllByText(/^(Su|Mo|Tu|We|Th|Fr|Sa)$/)
      .filter((el) => el.tagName === 'TH');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveTextContent('Su');

    // March 2026 starts on a Sunday and showOutsideDays pads to full weeks:
    // Mar 1 – Apr 4 → 5 rows × 7 cells.
    const cells = within(grid).getAllByTestId('calendar-day');
    expect(cells).toHaveLength(35);
    expect(cells[0]).toHaveAttribute('data-date', '2026-03-01');

    expect(getCell('2026-03-15')).toHaveAttribute('data-today', 'true');
    expect(getCell('2026-03-16')).not.toHaveAttribute('data-today');
    expect(getCell('2026-04-02')).toHaveAttribute('data-outside', 'true');
    expect(getCell('2026-03-25')).not.toHaveAttribute('data-outside');
  });
});

describe('Compact month grid', () => {
  it('caps month cells at 3 chips with a "+N more" hint, and shows every chip in the week view', () => {
    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    // 2026-03-18 sits in both the month grid and the anchor week (Mar 15–21).
    renderModern({
      tasks: titles.map((title, index) =>
        makeTask({ title, dueDate: MARCH(18, 9 + index) })
      ),
    });

    const monthCell = getCell('2026-03-18');
    const monthChips = within(monthCell).getAllByTestId('task-chip');
    expect(monthChips).toHaveLength(3);
    expect(monthChips.map((chip) => chip.textContent)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);

    const moreHint = within(monthCell).getByTestId('calendar-day-more');
    expect(moreHint).toHaveTextContent('+2 more');
    expect(moreHint).toHaveAttribute('title', 'Delta, Echo');
    // The hint is display-only: no button role, not focusable.
    expect(moreHint).not.toHaveAttribute('role');
    expect(moreHint).not.toHaveAttribute('tabindex');

    fireEvent.click(screen.getByTestId('calendar-view-week'));
    const weekCell = getCell('2026-03-18');
    expect(within(weekCell).getAllByTestId('task-chip')).toHaveLength(5);
    expect(
      within(weekCell).queryByTestId('calendar-day-more')
    ).not.toBeInTheDocument();
    for (const title of titles) {
      expect(within(weekCell).getByText(title)).toBeVisible();
    }
  });
});

describe('Agenda view', () => {
  it('toggles to the agenda view and back to month via the toolbar', () => {
    renderModern();

    fireEvent.click(screen.getByTestId('calendar-view-agenda'));
    expect(screen.getByTestId('calendar-view-agenda')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('calendar-grid-agenda')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-grid-month')).not.toBeInTheDocument();
    // Anchor 2026-03-15 → the 30-day window is Mar 15 – Apr 13.
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Mar 15 – Apr 13, 2026'
    );

    fireEvent.click(screen.getByTestId('calendar-view-month'));
    expect(screen.getByTestId('calendar-grid-month')).toBeInTheDocument();
    expect(
      screen.queryByTestId('calendar-grid-agenda')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'March 2026'
    );
  });

  it('groups tasks by ascending day inside the window and drops tasks outside it', () => {
    renderModern({
      tasks: [
        makeTask({ title: 'Day after', dueDate: APRIL(14) }),
        makeTask({ title: 'Last window day', dueDate: APRIL(13) }),
        makeTask({ title: 'Mid window', dueDate: MARCH(25) }),
        makeTask({ title: 'Second day', dueDate: MARCH(16, 8) }),
        makeTask({ title: 'Anchor day', dueDate: MARCH(15, 20) }),
        makeTask({ title: 'Day before', dueDate: MARCH(14) }),
      ],
    });
    fireEvent.click(screen.getByTestId('calendar-view-agenda'));

    const agenda = screen.getByTestId('calendar-grid-agenda');
    const days = within(agenda).getAllByTestId('agenda-day');
    expect(days.map((day) => day.getAttribute('data-date'))).toEqual([
      '2026-03-15',
      '2026-03-16',
      '2026-03-25',
      '2026-04-13',
    ]);
    expect(days[0]).toHaveTextContent('Sun, Mar 15, 2026');

    // Only days with tasks render, and out-of-window tasks are gone.
    expect(within(agenda).queryByText('Day before')).not.toBeInTheDocument();
    expect(within(agenda).queryByText('Day after')).not.toBeInTheDocument();

    // Each task lives in the day group of its due date.
    const secondDayGroup = within(agenda)
      .getByText('Second day')
      .closest('section');
    expect(
      secondDayGroup?.querySelector('[data-testid="agenda-day"]')
    ).toHaveAttribute('data-date', '2026-03-16');
    const lastDayGroup = within(agenda)
      .getByText('Last window day')
      .closest('section');
    expect(
      lastDayGroup?.querySelector('[data-testid="agenda-day"]')
    ).toHaveAttribute('data-date', '2026-04-13');
  });

  it('navigates the window in 30-day steps and returns to today', () => {
    renderModern();
    fireEvent.click(screen.getByTestId('calendar-view-agenda'));

    fireEvent.click(screen.getByTestId('calendar-next'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Apr 14 – May 13, 2026'
    );

    fireEvent.click(screen.getByTestId('calendar-prev'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Mar 15 – Apr 13, 2026'
    );

    fireEvent.click(screen.getByTestId('calendar-prev'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Feb 13 – Mar 14, 2026'
    );

    fireEvent.click(screen.getByTestId('calendar-today'));
    expect(screen.getByTestId('calendar-label')).toHaveTextContent(
      'Mar 15 – Apr 13, 2026'
    );
  });

  it('shows the empty-state message when no task falls in the window', () => {
    renderModern({
      tasks: [makeTask({ title: 'Out of range', dueDate: APRIL(20) })],
    });
    fireEvent.click(screen.getByTestId('calendar-view-agenda'));

    expect(screen.getByTestId('agenda-empty')).toHaveTextContent(
      'No tasks due in this period.'
    );
    expect(screen.queryByTestId('agenda-day')).not.toBeInTheDocument();
  });

  it('opens a task via onViewTask when its agenda row is clicked', () => {
    const task = makeTask({ title: 'Agenda click', dueDate: MARCH(16) });
    renderModern({ tasks: [task] });
    fireEvent.click(screen.getByTestId('calendar-view-agenda'));

    fireEvent.click(screen.getByText('Agenda click'));

    expect(mockOnViewTask).toHaveBeenCalledTimes(1);
    expect(mockOnViewTask).toHaveBeenCalledWith(task);
  });
});

describe('TaskCalendarView default export', () => {
  it('renders the modern calendar and none of the legacy markup', () => {
    render(<TaskCalendarView tasks={[]} onViewTask={mockOnViewTask} />);

    expect(screen.getByTestId('calendar-root')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-calendar')).not.toBeInTheDocument();
  });
});
