// src/types/index.ts

export interface Link {
  id: string;
  url: string;
  title?: string; // Was `name` in old, `title` in new. Represents webpage title.
  favIconUrl?: string; // Was `favicon` in old, `favIconUrl` in new. URL to the favicon.
  createdAt: Date; // Date of creation
  tags?: string[]; // Optional tags for categorization
  notes?: string; // Optional user notes for the link
  order?: number; // Optional field for explicit ordering within a collection
}

export interface Collection {
  id: string;
  name: string;
  description?: string; // Optional description of the collection
  links: Link[]; // Array of Link objects
  createdAt: Date; // Date of creation
  updatedAt: Date; // Date of last update
  color?: string; // e.g., a hex code for custom theming of the collection
  minimized?: boolean; // If the collection is rendered in a minimized state
  order?: number; // Optional field for explicit ordering of collections within a project
}

export interface Project {
  id: string;
  name: string;
  description?: string; // Optional description of the project
  collections: Collection[]; // Array of Collection objects
  createdAt: Date; // Date of creation
  updatedAt: Date; // Date of last update
  icon?: string; // e.g., initials, emoji, or an icon name
  color?: string; // e.g., a hex code for the project's theme color
  bookmarkFolderId?: string; // ID of the associated Chrome bookmark folder for sync
}

// Preserved existing types
export interface QuickLink {
  id: string;
  title: string;
  url: string;
  favicon?: string;
}

// New types for simulating Chrome tabs and windows
export interface ChromeTabInfo {
  id: number; // Simulated Chrome's tab ID
  title: string;
  url: string;
  favIconUrl?: string;
  windowId: number;
}

export interface ChromeWindowInfo {
  id: number; // Simulated Chrome's window ID
  name: string; // User-defined name, initially "Window X"
  tabs: ChromeTabInfo[];
  isFocused?: boolean;
  type?: string;
}

export type VerticalTabId = 'openTabs' | 'bookmarks' | 'notes' | 'todos';
