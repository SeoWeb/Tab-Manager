
import { create } from 'zustand';
import type { Project, Collection, Link, QuickLink, ChromeWindowInfo, ChromeTabInfo, VerticalTabId } from '@/types';
import {nanoid} from 'nanoid'; 

const generateId = () => nanoid(); // Using nanoid for unique IDs

// Mock data for Chrome Windows and Tabs
const mockChromeWindows: ChromeWindowInfo[] = [
  {
    id: 1,
    name: 'Work Projects',
    tabs: [
      { id: 101, title: 'Q3 Planning Doc - Google Docs', url: 'https://docs.google.com/document/d/example1', favIconUrl: 'https://www.google.com/s2/favicons?domain=docs.google.com', windowId: 1 },
      { id: 102, title: 'Competitor Analysis - Figma', url: 'https://www.figma.com/file/example2', favIconUrl: 'https://www.google.com/s2/favicons?domain=figma.com', windowId: 1 },
      { id: 103, title: 'Internal Dashboard', url: 'https://internal.example.com/dashboard', favIconUrl: 'https://www.google.com/s2/favicons?domain=example.com', windowId: 1 },
    ],
    isFocused: true,
  },
  {
    id: 2,
    name: 'Research & News',
    tabs: [
      { id: 201, title: 'Tech News Today - TechCrunch', url: 'https://techcrunch.com', favIconUrl: 'https://www.google.com/s2/favicons?domain=techcrunch.com', windowId: 2 },
      { id: 202, title: 'Next.js Official Docs', url: 'https://nextjs.org/docs', favIconUrl: 'https://www.google.com/s2/favicons?domain=nextjs.org', windowId: 2 },
    ],
  }
];


interface AppState {
  // UI State
  activeProjectId: string | null;
  isDarkMode: boolean; 
  
  // New Right Panel State
  activeVerticalTabId: VerticalTabId | null;
  isRightContentPanelOpen: boolean;

  // Data
  projects: Project[];
  chromeWindows: ChromeWindowInfo[]; // For "Open Tabs" feature
  quickLinks: QuickLink[]; 
  notes: string;
  todos: { id: string; text: string; completed: boolean }[];

  // Modal States
  isAddProjectModalOpen: boolean;
  isAddCollectionModalOpen: boolean;
  isAddLinkModalOpen: boolean;
  editingCollectionIdForLink: string | null; 

  // Actions
  setActiveProject: (id: string | null) => void;
  toggleDarkMode: () => void;

  // New Right Panel Actions
  setActiveVerticalTabId: (tabId: VerticalTabId | null) => void;
  toggleRightContentPanel: (forceOpen?: boolean, tabId?: VerticalTabId) => void;
  
  // Project actions
  addProject: (project: Omit<Project, 'id' | 'collections'> & { collections?: Collection[] }) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  
  // Collection actions
  addCollection: (projectId: string, collection: Omit<Collection, 'id' | 'links' | 'order'> & { links?: Link[], order?: number }) => void;
  updateCollection: (projectId: string, collectionId: string, updates: Partial<Collection>) => void;
  deleteCollection: (projectId: string, collectionId: string) => void;
  
  // Link actions
  addLink: (projectId: string, collectionId: string, link: Omit<Link, 'id' | 'order'> & { order?: number }) => void;
  updateLink: (projectId: string, collectionId: string, linkId: string, updates: Partial<Link>) => void;
  deleteLink: (projectId: string, collectionId: string, linkId: string) => void;

  // Quick Links actions (will be phased out or repurposed if "Open Tabs" takes over fully)
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

  // AI Suggestion
  setCollectionName: (projectId: string, collectionId: string, name: string) => void;

  // Chrome Windows/Tabs actions (for mock data)
  renameChromeWindow: (windowId: number, newName: string) => void;
  addChromeWindowToCollections: (windowInfo: ChromeWindowInfo) => void;
  // Placeholder for D&D: addChromeTabToCollection
}

const initialProjects: Project[] = [
  {
    id: generateId(),
    name: 'Work',
    color: '#4285F4',
    collections: [
      {
        id: generateId(),
        name: 'Q3 Planning',
        links: [
          { id: generateId(), name: 'Project Brief', url: 'https://docs.example.com/brief', order: 0 },
          { id: generateId(), name: 'Roadmap', url: 'https://sheets.example.com/roadmap', order: 1 },
        ],
        isMinimized: false,
        order: 0,
      },
    ],
  },
  {
    id: generateId(),
    name: 'Personal',
    color: '#34A853',
    collections: [
      {
        id: generateId(),
        name: 'Recipes',
        links: [
          { id: generateId(), name: 'Pasta Recipe', url: 'https://recipes.example.com/pasta', order: 0 },
        ],
        isMinimized: false,
        order: 0,
      }
    ],
  },
];

export const useAppStore = create<AppState>((set, get) => ({
  activeProjectId: initialProjects.length > 0 ? initialProjects[0].id : null,
  isDarkMode: false,
  
  activeVerticalTabId: null, 
  isRightContentPanelOpen: false,

  projects: initialProjects,
  chromeWindows: mockChromeWindows,
  quickLinks: [], // This might be deprecated by the new "Open Tabs"
  notes: '',
  todos: [],

  isAddProjectModalOpen: false,
  isAddCollectionModalOpen: false,
  isAddLinkModalOpen: false,
  editingCollectionIdForLink: null,

  setActiveProject: (id) => set({ activeProjectId: id }),
  toggleDarkMode: () => {
    set((state) => {
      const newIsDarkMode = !state.isDarkMode;
      if (newIsDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { isDarkMode: newIsDarkMode };
    });
  },

  setActiveVerticalTabId: (tabId) => set({ activeVerticalTabId: tabId }),
  toggleRightContentPanel: (forceOpen, tabId) => set((state) => {
    let newOpenState = forceOpen !== undefined ? forceOpen : !state.isRightContentPanelOpen;
    let newActiveTabId = state.activeVerticalTabId;

    if (tabId) { // If a specific tab is clicked
      if (state.isRightContentPanelOpen && state.activeVerticalTabId === tabId) {
        // Clicking the active tab closes the panel
        newOpenState = false;
        newActiveTabId = null; // Or keep it to reopen to the same tab
      } else {
        // Clicking a new tab or opening the panel
        newOpenState = true;
        newActiveTabId = tabId;
      }
    } else if (forceOpen === false) { // Generic close
        newActiveTabId = null; // Clear active tab when panel is forced closed
    }


    return { 
      isRightContentPanelOpen: newOpenState,
      activeVerticalTabId: newActiveTabId
    };
  }),
  
  addProject: (project) => set((state) => ({
    projects: [...state.projects, { ...project, id: generateId(), collections: project.collections || [] }],
  })),
  updateProject: (id, updates) => set((state) => ({
    projects: state.projects.map(p => p.id === id ? { ...p, ...updates } : p),
  })),
  deleteProject: (id) => set((state) => ({
    projects: state.projects.filter(p => p.id !== id),
    activeProjectId: state.activeProjectId === id ? (state.projects.length > 1 ? state.projects.find(p => p.id !== id)?.id ?? null : null) : state.activeProjectId,
  })),

  addCollection: (projectId, collection) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        const newCollection: Collection = {
          ...collection,
          id: generateId(),
          links: collection.links || [],
          isMinimized: false,
          order: collection.order !== undefined ? collection.order : p.collections.length,
        };
        return { ...p, collections: [...p.collections, newCollection] };
      }
      return p;
    }),
  })),
  updateCollection: (projectId, collectionId, updates) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          collections: p.collections.map(c => c.id === collectionId ? { ...c, ...updates } : c),
        };
      }
      return p;
    }),
  })),
  deleteCollection: (projectId, collectionId) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, collections: p.collections.filter(c => c.id !== collectionId) };
      }
      return p;
    }),
  })),

  addLink: (projectId, collectionId, link) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          collections: p.collections.map(c => {
            if (c.id === collectionId) {
              const newLink: Link = {
                ...link,
                id: generateId(),
                order: link.order !== undefined ? link.order : c.links.length,
              };
              return { ...c, links: [...c.links, newLink] };
            }
            return c;
          }),
        };
      }
      return p;
    }),
  })),
  updateLink: (projectId, collectionId, linkId, updates) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          collections: p.collections.map(c => {
            if (c.id === collectionId) {
              return { ...c, links: c.links.map(l => l.id === linkId ? { ...l, ...updates } : l) };
            }
            return c;
          }),
        };
      }
      return p;
    }),
  })),
  deleteLink: (projectId, collectionId, linkId) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          collections: p.collections.map(c => {
            if (c.id === collectionId) {
              return { ...c, links: c.links.filter(l => l.id !== linkId) };
            }
            return c;
          }),
        };
      }
      return p;
    }),
  })),

  addQuickLink: (link) => set((state) => ({ quickLinks: [...state.quickLinks, { ...link, id: generateId() }] })),
  removeQuickLink: (id) => set((state) => ({ quickLinks: state.quickLinks.filter(ql => ql.id !== id) })),

  updateNotes: (notes) => set({ notes }),

  addTodo: (text) => set((state) => ({ todos: [...state.todos, { id: generateId(), text, completed: false }] })),
  toggleTodo: (id) => set((state) => ({
    todos: state.todos.map(todo => todo.id === id ? { ...todo, completed: !todo.completed } : todo),
  })),
  removeTodo: (id) => set((state) => ({ todos: state.todos.filter(todo => todo.id !== id) })),

  openAddProjectModal: () => set({ isAddProjectModalOpen: true }),
  closeAddProjectModal: () => set({ isAddProjectModalOpen: false }),
  openAddCollectionModal: () => set({ isAddCollectionModalOpen: true }),
  closeAddCollectionModal: () => set({ isAddCollectionModalOpen: false }),
  openAddLinkModal: (collectionId) => set({ isAddLinkModalOpen: true, editingCollectionIdForLink: collectionId }),
  closeAddLinkModal: () => set({ isAddLinkModalOpen: false, editingCollectionIdForLink: null }),
  
  setCollectionName: (projectId, collectionId, name) => {
    get().updateCollection(projectId, collectionId, { name });
  },

  renameChromeWindow: (windowId, newName) => set(state => ({
    chromeWindows: state.chromeWindows.map(win => win.id === windowId ? { ...win, name: newName } : win)
  })),
  addChromeWindowToCollections: (windowInfo) => {
    const activeProjectId = get().activeProjectId;
    if (!activeProjectId) {
      console.warn("No active project to add collection to.");
      // Potentially open AddProjectModal or notify user
      return;
    }
    const newCollectionName = windowInfo.name || `Window ${windowInfo.id} Tabs`;
    const newLinks: Link[] = windowInfo.tabs.map((tab, index) => ({
      id: generateId(),
      name: tab.title,
      url: tab.url,
      favicon: tab.favIconUrl,
      order: index,
    }));
    get().addCollection(activeProjectId, {
      name: newCollectionName,
      links: newLinks,
    });
  }
}));

// Remove old state: rightPanelTab, isRightPanelOpen, setRightPanelTab, toggleRightPanel
// Added: activeVerticalTabId, isRightContentPanelOpen, setActiveVerticalTabId, toggleRightContentPanel
// Added: chromeWindows, renameChromeWindow, addChromeWindowToCollections
