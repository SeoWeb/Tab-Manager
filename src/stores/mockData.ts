import type { Project, ChromeWindowInfo } from '@/types';
import { nanoid } from 'nanoid';

const generateId = () => nanoid();

// Mock data for Chrome Windows and Tabs
export const mockChromeWindows: ChromeWindowInfo[] = [
  {
    id: 1,
    name: 'Work Projects',
    tabs: [
      {
        id: 101,
        title: 'Q3 Planning Doc - Google Docs',
        url: 'https://docs.google.com/document/d/example1',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=docs.google.com',
        windowId: 1,
      },
      {
        id: 102,
        title: 'Competitor Analysis - Figma',
        url: 'https://www.figma.com/file/example2',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=figma.com',
        windowId: 1,
      },
      {
        id: 103,
        title: 'Internal Dashboard',
        url: 'https://internal.example.com/dashboard',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=example.com',
        windowId: 1,
      },
    ],
    isFocused: true,
  },
  {
    id: 2,
    name: 'Research & News',
    tabs: [
      {
        id: 201,
        title: 'Tech News Today - TechCrunch',
        url: 'https://techcrunch.com',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=techcrunch.com',
        windowId: 2,
      },
      {
        id: 202,
        title: 'Next.js Official Docs',
        url: 'https://nextjs.org/docs',
        favIconUrl: 'https://www.google.com/s2/favicons?domain=nextjs.org',
        windowId: 2,
      },
    ],
  },
];

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
    collections: [
      {
        id: generateId(),
        name: 'Q3 Planning',
        description: 'Planning documents and resources for the third quarter.',
        links: [
          {
            id: generateId(),
            title: 'Project Brief',
            url: 'https://docs.example.com/brief',
            order: 0,
            createdAt: new Date(),
            favIconUrl:
              'https://www.google.com/s2/favicons?domain=docs.example.com',
            tags: ['planning', 'brief'],
            notes: 'Main project brief document.',
          },
          {
            id: generateId(),
            title: 'Roadmap',
            url: 'https://sheets.example.com/roadmap',
            order: 1,
            createdAt: new Date(),
            favIconUrl:
              'https://www.google.com/s2/favicons?domain=sheets.example.com',
            tags: ['planning', 'roadmap'],
            notes: 'Product and feature roadmap.',
          },
        ],
        minimized: false,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        color: undefined,
      },
    ],
  },
  {
    id: generateId(),
    name: 'Personal',
    description: 'Personal projects, hobbies, and interests.',
    color: '#34A853',
    icon: '🏠',
    createdAt: new Date(),
    updatedAt: new Date(),
    bookmarkFolderId: undefined,
    collections: [
      {
        id: generateId(),
        name: 'Recipes',
        description: 'Collection of favorite recipes.',
        links: [
          {
            id: generateId(),
            title: 'Pasta Recipe',
            url: 'https://recipes.example.com/pasta',
            order: 0,
            createdAt: new Date(),
            favIconUrl:
              'https://www.google.com/s2/favicons?domain=recipes.example.com',
            tags: ['food', 'pasta'],
            notes: 'Delicious pasta recipe.',
          },
        ],
        minimized: false,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        color: undefined,
      },
    ],
  },
];
