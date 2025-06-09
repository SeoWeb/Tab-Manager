import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import type {
  Project,
  Collection,
  Link,
  QuickLink,
  ChromeWindowInfo,
  VerticalTabId,
} from '@/types';
import { nanoid } from 'nanoid';

// Custom storage adapter for chrome.storage.local
const chromeStorageApi: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.get([name], (result) => {
          resolve(result[name] || null);
        });
      } else {
        // Chrome storage API is not available (e.g., during SSR or in a non-extension environment)
        console.warn(
          'chrome.storage.local is not available. Persisted state will not be loaded.'
        );
        resolve(null);
      }
    });
  },
  setItem: async (name: string, value: string): Promise<void> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.set({ [name]: value }, () => {
          resolve();
        });
      } else {
        console.warn(
          'chrome.storage.local is not available. State will not be persisted.'
        );
        resolve();
      }
    });
  },
  removeItem: async (name: string): Promise<void> => {
    return new Promise((resolve) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.remove([name], () => {
          resolve();
        });
      } else {
        console.warn(
          'chrome.storage.local is not available. Item will not be removed from persisted state.'
        );
        resolve();
      }
    });
  },
};

const generateId = () => nanoid(); // Using nanoid for unique IDs

// Mock data for Chrome Windows and Tabs
const mockChromeWindows: ChromeWindowInfo[] = [
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

// Define ActiveViewType
export type ActiveViewType = 'projectDetail' | 'settings';

interface AppState {
  // UI State
  activeProjectId: string | null;
  activeView: ActiveViewType; // Added activeView
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
  addProject: (
    project: Omit<Project, 'id' | 'collections' | 'createdAt' | 'updatedAt'>
  ) => void; // collections is optional here
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // Collection actions
  addCollection: (
    projectId: string,
    collection: Omit<
      Collection,
      'id' | 'links' | 'order' | 'createdAt' | 'updatedAt'
    > & { links?: Link[]; order?: number }
  ) => void;
  updateCollection: (
    projectId: string,
    collectionId: string,
    updates: Partial<Collection>
  ) => void;
  deleteCollection: (projectId: string, collectionId: string) => void;

  // Link actions
  addLink: (
    projectId: string,
    collectionId: string,
    link: Omit<Link, 'id' | 'order' | 'createdAt'> & { order?: number }
  ) => void;
  updateLink: (
    projectId: string,
    collectionId: string,
    linkId: string,
    updates: Partial<Link>
  ) => void;
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

  // View actions
  setActiveView: (view: ActiveViewType) => void; // Added setActiveView

  // AI Suggestion
  setCollectionName: (
    projectId: string,
    collectionId: string,
    name: string
  ) => void;

  // Chrome Windows/Tabs actions (for mock data)
  renameChromeWindow: (windowId: number, newName: string) => void;
  addChromeWindowToCollections: (windowInfo: ChromeWindowInfo) => void;
  // Placeholder for D&D: addChromeTabToCollection
}

const initialProjects: Project[] = [
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

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeProjectId:
        initialProjects.length > 0 ? initialProjects[0].id : null,
      activeView: 'projectDetail', // Initialized activeView
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

      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          activeView: id ? 'projectDetail' : get().activeView,
        }), // Modified setActiveProject
      setActiveView: (view: ActiveViewType) => set({ activeView: view }), // Added setActiveView action
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
      toggleRightContentPanel: (forceOpen, tabId) =>
        set((state) => {
          let newOpenState =
            forceOpen !== undefined
              ? forceOpen
              : !state.isRightContentPanelOpen;
          let newActiveTabId = state.activeVerticalTabId;

          if (tabId) {
            // If a specific tab is clicked
            if (
              state.isRightContentPanelOpen &&
              state.activeVerticalTabId === tabId
            ) {
              // Clicking the active tab closes the panel
              newOpenState = false;
              newActiveTabId = null; // Or keep it to reopen to the same tab
            } else {
              // Clicking a new tab or opening the panel
              newOpenState = true;
              newActiveTabId = tabId;
            }
          } else if (forceOpen === false) {
            // Generic close
            newActiveTabId = null; // Clear active tab when panel is forced closed
          }

          return {
            isRightContentPanelOpen: newOpenState,
            activeVerticalTabId: newActiveTabId,
          };
        }),

      addProject: (projectInput) =>
        set((state) => {
          const newProject: Project = {
            id: generateId(),
            name: projectInput.name,
            description: projectInput.description || '',
            color: projectInput.color || '#CCCCCC', // Default color
            icon: projectInput.icon || '',
            collections: [], // New projects start with no collections by default
            createdAt: new Date(),
            updatedAt: new Date(),
            bookmarkFolderId: projectInput.bookmarkFolderId || undefined,
          };
          return { projects: [...state.projects, newProject] };
        }),
      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
          ),
        })),
      deleteProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProjectId:
            state.activeProjectId === id
              ? state.projects.length > 1
                ? (state.projects.find((p) => p.id !== id)?.id ?? null)
                : null
              : state.activeProjectId,
        })),

      addCollection: (projectId, collectionInput) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              const newCollection: Collection = {
                id: generateId(),
                name: collectionInput.name,
                description: collectionInput.description || '',
                links: collectionInput.links || [],
                minimized: false,
                order:
                  collectionInput.order !== undefined
                    ? collectionInput.order
                    : p.collections.length,
                createdAt: new Date(),
                updatedAt: new Date(),
                color: collectionInput.color || undefined,
              };
              return {
                ...p,
                collections: [...p.collections, newCollection],
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),
      updateCollection: (projectId, collectionId, updates) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) =>
                  c.id === collectionId
                    ? { ...c, ...updates, updatedAt: new Date() }
                    : c
                ),
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),
      deleteCollection: (projectId, collectionId) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.filter((c) => c.id !== collectionId),
              };
            }
            return p;
          }),
        })),

      addLink: (projectId, collectionId, linkInput) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) => {
                  if (c.id === collectionId) {
                    const newLink: Link = {
                      id: generateId(),
                      url: linkInput.url,
                      title: linkInput.title || 'Untitled Link',
                      favIconUrl: linkInput.favIconUrl || '',
                      createdAt: new Date(),
                      tags: linkInput.tags || [],
                      notes: linkInput.notes || '',
                      order:
                        linkInput.order !== undefined
                          ? linkInput.order
                          : c.links.length,
                    };
                    return {
                      ...c,
                      links: [...c.links, newLink],
                      updatedAt: new Date(),
                    };
                  }
                  return c;
                }),
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),
      updateLink: (projectId, collectionId, linkId, updates) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) => {
                  if (c.id === collectionId) {
                    return {
                      ...c,
                      links: c.links.map((l) =>
                        l.id === linkId
                          ? { ...l, ...updates, updatedAt: new Date() }
                          : l
                      ),
                      updatedAt: new Date(),
                    };
                  }
                  return c;
                }),
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),
      deleteLink: (projectId, collectionId, linkId) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) => {
                  if (c.id === collectionId) {
                    return {
                      ...c,
                      links: c.links.filter((l) => l.id !== linkId),
                      updatedAt: new Date(),
                    };
                  }
                  return c;
                }),
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),

      addQuickLink: (link) =>
        set((state) => ({
          quickLinks: [...state.quickLinks, { ...link, id: generateId() }],
        })),
      removeQuickLink: (id) =>
        set((state) => ({
          quickLinks: state.quickLinks.filter((l) => l.id !== id),
        })),

      updateNotes: (notes) => set({ notes }),

      addTodo: (text) =>
        set((state) => ({
          todos: [...state.todos, { id: generateId(), text, completed: false }],
        })),
      toggleTodo: (id) =>
        set((state) => ({
          todos: state.todos.map((todo) =>
            todo.id === id ? { ...todo, completed: !todo.completed } : todo
          ),
        })),
      removeTodo: (id) =>
        set((state) => ({
          todos: state.todos.filter((todo) => todo.id !== id),
        })),

      openAddProjectModal: () => set({ isAddProjectModalOpen: true }),
      closeAddProjectModal: () => set({ isAddProjectModalOpen: false }),
      openAddCollectionModal: () => set({ isAddCollectionModalOpen: true }),
      closeAddCollectionModal: () => set({ isAddCollectionModalOpen: false }),
      openAddLinkModal: (collectionId) =>
        set({
          isAddLinkModalOpen: true,
          editingCollectionIdForLink: collectionId,
        }),
      closeAddLinkModal: () =>
        set({ isAddLinkModalOpen: false, editingCollectionIdForLink: null }),

      setCollectionName: (projectId, collectionId, name) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) =>
                  c.id === collectionId
                    ? { ...c, name, updatedAt: new Date() }
                    : c
                ),
                updatedAt: new Date(),
              };
            }
            return p;
          }),
        })),

      renameChromeWindow: (windowId, newName) =>
        set((state) => ({
          chromeWindows: state.chromeWindows.map((win) =>
            win.id === windowId ? { ...win, name: newName } : win
          ),
        })),
      addChromeWindowToCollections: (windowInfo) => {
        const activeProjectId = get().activeProjectId;
        if (!activeProjectId) {
          console.error('No active project to add the window to.');
          return;
        }

        const newLinks: Link[] = windowInfo.tabs.map((tab, index) => ({
          id: generateId(),
          url: tab.url || '',
          title: tab.title || 'Untitled Tab',
          favIconUrl: tab.favIconUrl || '',
          createdAt: new Date(),
          order: index,
          tags: [],
          notes: '',
        }));

        get().addCollection(activeProjectId, {
          name: windowInfo.name || 'New Window Collection',
          links: newLinks,
        });
      },
    }),
    {
      name: 'tab-manager-storage', // Name of the item in chrome.storage.local
      storage: createJSONStorage(() => chromeStorageApi),
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        isDarkMode: state.isDarkMode,
        quickLinks: state.quickLinks,
        notes: state.notes,
        todos: state.todos,
        activeView: state.activeView,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate state from storage:', error);
        }
        if (state) {
          // Apply dark mode on load
          if (state.isDarkMode) {
            document.documentElement.classList.add('dark');
          }
        }
      },
    }
  )
);

// Selector hooks for convenience
export const useActiveProject = () => {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const projects = useAppStore((state) => state.projects);
  return projects.find((p) => p.id === activeProjectId) || null;
};

export const useEditingCollection = () => {
  const activeProject = useActiveProject();
  const editingCollectionId = useAppStore(
    (state) => state.editingCollectionIdForLink
  );
  if (!activeProject || !editingCollectionId) return null;
  return (
    activeProject.collections.find((c) => c.id === editingCollectionId) || null
  );
};
