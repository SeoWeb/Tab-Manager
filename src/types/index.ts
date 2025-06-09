
export interface Link {
  id: string;
  name: string;
  url: string;
  favicon?: string; // URL to the favicon
  order: number;
}

export interface Collection {
  id: string;
  name: string;
  links: Link[];
  isMinimized: boolean;
  order: number;
}

export interface Project {
  id:string;
  name: string;
  color: string; // Hex color string
  collections: Collection[];
}

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
