import type { Project, ChromeWindowInfo } from '@/types';
import type { AdvancedTask } from '@/types/tasks';

// Deterministic defaults: every context (popup, newtab, service worker) must
// boot with byte-identical default state — fixed IDs and a fixed timestamp —
// so no module-load randomness (nanoid/new Date()) can produce diverging
// defaults before persisted state hydrates.
export const INITIAL_PROJECT_ID = 'ts-default-project-0000';
const INITIAL_TIMESTAMP = new Date('2024-01-01T00:00:00.000Z');

// Mock data for Chrome Windows and Tabs
export const mockChromeWindows: ChromeWindowInfo[] = [];

export const initialProjects: Project[] = [
  {
    id: INITIAL_PROJECT_ID,
    name: 'Work',
    description: 'Projects related to work tasks and responsibilities.',
    color: '#4285F4',
    icon: '💼',
    createdAt: INITIAL_TIMESTAMP,
    updatedAt: INITIAL_TIMESTAMP,
    bookmarkFolderId: undefined,
    collections: [],
  },
];

// Sample tasks with due dates for testing calendar functionality
export const initialTasks: AdvancedTask[] = [];
