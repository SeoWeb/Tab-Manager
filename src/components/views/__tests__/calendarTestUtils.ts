import type { AdvancedTask } from '@/types/tasks';

let nextId = 0;

/** Minimal valid AdvancedTask for calendar tests. */
export function makeTask(overrides: Partial<AdvancedTask> = {}): AdvancedTask {
  nextId += 1;
  return {
    id: `task-${nextId}`,
    title: 'Task',
    priority: 'medium',
    status: 'todo',
    category: 'general',
    tags: [],
    subtasks: [],
    attachments: [],
    notes: '',
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    progress: 0,
    comments: [],
    activities: [],
    reminders: [],
    isArchived: false,
    isFavorite: false,
    customFields: {},
    ...overrides,
  };
}

/** Local-time date helper: MARCH(10) is 2026-03-10 at noon. */
export function MARCH(day: number, hours = 12): Date {
  return new Date(2026, 2, day, hours, 0, 0, 0);
}

/** Local-time date helper: APRIL(13) is 2026-04-13 at noon. */
export function APRIL(day: number, hours = 12): Date {
  return new Date(2026, 3, day, hours, 0, 0, 0);
}

/**
 * A controllable DataTransfer for jsdom drag events: `setData` writes into a
 * shared payload that `getData` reads back, mirroring the browser contract
 * between dragstart and drop.
 */
export function createDataTransfer() {
  const payload: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      payload[type] = value;
    },
    getData: (type: string) => payload[type] ?? '',
    effectAllowed: 'all',
  };
}
