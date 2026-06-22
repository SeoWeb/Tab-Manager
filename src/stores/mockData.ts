import type { Project, ChromeWindowInfo } from '@/types';
import type { AdvancedTask } from '@/types/tasks';
import { nanoid } from 'nanoid';

const generateId = () => nanoid();

// Mock data for Chrome Windows and Tabs
export const mockChromeWindows: ChromeWindowInfo[] = [];

export const initialProjects: Project[] = [
  {
    id: generateId(),
    name: 'Work',
    description: 'Projects related to work tasks and responsibilities.',
    color: '#4285F4',
    icon: '💼',
    createdAt: new Date(),
    updatedAt: new Date(),
    bookmarkFolderId: undefined,
    collections: [],
  },
];

// Sample tasks with due dates for testing calendar functionality
export const initialTasks: AdvancedTask[] = [];
