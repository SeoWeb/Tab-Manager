export interface Link {
  id: string;
  name: string;
  url: string;
  favicon?: string; // URL to the favicon
  order: number;
  // bookmarkId: string; // Less relevant for web app, kept for proposal consistency
}

export interface Collection {
  id: string;
  name: string;
  links: Link[];
  isMinimized: boolean;
  order: number;
  // bookmarkFolderId: string; // Less relevant for web app
}

export interface Project {
  id:string;
  name: string;
  color: string; // Hex color string
  collections: Collection[];
  // bookmarkFolderId: string; // Less relevant for web app
}

// For Right Panel adapted "Open Tabs" / "Quick Add"
export interface QuickLink {
  id: string; // Can be temp ID or URL
  title: string;
  url: string;
  favicon?: string;
}
