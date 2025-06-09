import type {
  Project,
  Collection,
  Link,
  QuickLink,
  ChromeWindowInfo,
  VerticalTabId,
} from '@/types';

// Define ActiveViewType
export type ActiveViewType = 'projectDetail' | 'settings';

export interface AppState {
  // UI State
  activeProjectId: string | null;
  activeView: ActiveViewType;
  isDarkMode: boolean;

  // New Right Panel State
  activeVerticalTabId: VerticalTabId | null;
  isRightContentPanelOpen: boolean;

  // Data
  projects: Project[];
  tabManagerRootFolderId: string | null;
  chromeWindows: ChromeWindowInfo[];
  quickLinks: QuickLink[];
  notes: string;
  todos: { id: string; text: string; completed: boolean }[];

  // Modal States
  isAddProjectModalOpen: boolean;
  isAddCollectionModalOpen: boolean;
  isAddLinkModalOpen: boolean;
  isEditLinkModalOpen: boolean;
  editingCollectionIdForLink: string | null;
  editingCollectionId: string | null;
  editingLinkId: string | null;

  // Hydration state
  _hasHydrated: boolean;

  // Actions
  setHasHydrated: (hydrated: boolean) => void;
  setActiveProject: (id: string | null) => void;
  toggleDarkMode: () => void;

  // New Right Panel Actions
  setActiveVerticalTabId: (tabId: VerticalTabId | null) => void;
  toggleRightContentPanel: (forceOpen?: boolean, tabId?: VerticalTabId) => void;

  // Project actions
  initializeTabManagerRootFolder: () => Promise<void>;
  syncBookmarks: () => Promise<void>;
  addProject: (
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>
  ) => void;
  updateProject: (
    id: string,
    updates: Partial<Project>,
    isInternalCall?: boolean
  ) => void;
  deleteProject: (id: string) => void;

  // Collection actions
  addCollection: (
    projectId: string,
    collectionData: Pick<Collection, 'name' | 'description' | 'color'>
  ) => void;
  updateCollection: (
    projectId: string,
    collectionId: string,
    updates: Partial<Collection>,
    isInternalCall?: boolean
  ) => void;
  deleteCollection: (projectId: string, collectionId: string) => void;
  moveCollection: (
    projectId: string,
    collectionId: string,
    direction: 'up' | 'down'
  ) => void;
  openCollectionInNewWindow: (projectId: string, collectionId: string) => void;

  // Link actions
  addLink: (
    projectId: string,
    collectionId: string,
    linkData: Pick<Link, 'title' | 'url' | 'favIconUrl' | 'tags' | 'notes'>
  ) => void;
  updateLink: (
    projectId: string,
    collectionId: string,
    linkId: string,
    updates: Partial<Link>,
    isInternalCall?: boolean
  ) => void;
  deleteLink: (projectId: string, collectionId: string, linkId: string) => void;

  // Quick Links actions
  addQuickLink: (link: Omit<QuickLink, 'id'>) => void;
  removeQuickLink: (id: string) => void;

  // Notes actions
  updateNotes: (notes: string) => void;

  // Todos actions
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;

  // Modal actions
  openAddProjectModal: () => void;
  closeAddProjectModal: () => void;
  openAddCollectionModal: () => void;
  closeAddCollectionModal: () => void;
  openAddLinkModal: (collectionId: string) => void;
  closeAddLinkModal: () => void;
  openEditLinkModal: (collectionId: string, linkId: string) => void;
  closeEditLinkModal: () => void;

  // View actions
  setActiveView: (view: ActiveViewType) => void;

  // AI Suggestion
  setCollectionName: (
    projectId: string,
    collectionId: string,
    name: string
  ) => void;

  // Chrome Windows/Tabs actions
  renameChromeWindow: (windowId: number, newName: string) => void;
  addChromeWindowToCollections: (windowInfo: ChromeWindowInfo) => void;

  // Drag & Drop actions
  moveLink: (
    projectId: string,
    sourceCollectionId: string,
    linkId: string,
    targetCollectionId: string
  ) => void;
  reorderLinks: (
    projectId: string,
    collectionId: string,
    activeLinkId: string,
    overLinkId: string
  ) => void;
  reorderCollections: (
    projectId: string,
    activeCollectionId: string,
    overCollectionId: string
  ) => void;
}
