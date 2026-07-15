// src/types/index.ts

import type { CloudRole } from '@/lib/cloudflareSync/types';

export interface Link {
  id: string;
  url: string;
  title?: string; // Was `name` in old, `title` in new. Represents webpage title.
  favIconUrl?: string; // Was `favicon` in old, `favIconUrl` in new. URL to the favicon.
  createdAt: Date; // Date of creation
  updatedAt: Date; // Date of last update (drives last-write-wins reconciliation)
  tags?: string[]; // Optional tags for categorization
  notes?: string; // Optional user notes for the link
  order?: number; // Optional field for explicit ordering within a collection
  bookmarkId?: string | null; // Store ID of the associated bookmark
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
  bookmarkFolderId?: string | null; // Store ID of the associated bookmark folder
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
  order?: number; // Optional field for explicit ordering of projects
  bookmarkFolderId?: string | null; // Store ID of the associated bookmark folder
  /**
   * Whether this project has a server-side counterpart and should sync through the
   * Cloudflare Worker. Cloud projects use the server-assigned id as their local id
   * (the Worker generates project ids via POST /projects); local-only projects use a
   * client nanoid. Entity ids (collection/link/...) stay client-authoritative either way.
   */
  cloudEnabled?: boolean;
  /**
   * The current user's role on a cloud project (Phase 4). Absent for local-only
   * projects, in which case the UI grants full control (local-first). Refreshed
   * from `GET /projects/:id` during sync and set at create/convert/invite-accept.
   * The backend remains the source of truth for actual authorization.
   */
  cloudRole?: CloudRole;
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

export type VerticalTabId =
  | 'openTabs'
  | 'bookmarks'
  | 'notes'
  | 'sessions'
  | 'simple-todo'
  | 'quickClips';
