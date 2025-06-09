import { create } from 'zustand';
import type { Project, Collection, Link, QuickLink } from '@/types';
import {nanoid} from 'nanoid'; // Using nanoid for unique IDs, ensure it's installed or use Math.random based solution

// Helper for unique IDs if nanoid is not preferred for this scaffolding
const generateId = () => Math.random().toString(36).substr(2, 9);


interface AppState {
  // UI State
  activeProjectId: string | null;
  rightPanelTab: 'quickLinks' | 'bookmarks' | 'notes' | 'todos';
  isRightPanelOpen: boolean;
  isDarkMode: boolean; // Added as per proposal, though not fully implemented in this pass
  
  // Data
  projects: Project[];
  quickLinks: QuickLink[]; // For the adapted "Open Tabs" panel
  notes: string;
  todos: { id: string; text: string; completed: boolean }[];

  // Modal States
  isAddProjectModalOpen: boolean;
  isAddCollectionModalOpen: boolean;
  isAddLinkModalOpen: boolean;
  editingCollectionIdForLink: string | null; // To know which collection to add link to

  // Actions
  setActiveProject: (id: string | null) => void;
  setRightPanelTab: (tab: AppState['rightPanelTab']) => void;
  toggleRightPanel: () => void;
  toggleDarkMode: () => void;
  
  // Project actions
  addProject: (project: Omit<Project, 'id' | 'collections'> & { collections?: Collection[] }) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  
  // Collection actions
  addCollection: (projectId: string, collection: Omit<Collection, 'id' | 'links' | 'order'> & { links?: Link[], order?: number }) => void;
  updateCollection: (projectId: string, collectionId: string, updates: Partial<Collection>) => void;
  deleteCollection: (projectId: string, collectionId: string) => void;
  // moveCollection: (projectId: string, fromIndex: number, toIndex: number) => void; // Defer D&D
  
  // Link actions
  addLink: (projectId: string, collectionId: string, link: Omit<Link, 'id' | 'order'> & { order?: number }) => void;
  updateLink: (projectId: string, collectionId: string, linkId: string, updates: Partial<Link>) => void;
  deleteLink: (projectId: string, collectionId: string, linkId: string) => void;
  // moveLink: (fromCollectionId: string, toCollectionId: string, linkId: string, projectId: string) => void; // Defer D&D

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

  // AI Suggestion
  setCollectionName: (projectId: string, collectionId: string, name: string) => void;
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
  rightPanelTab: 'quickLinks',
  isRightPanelOpen: false,
  isDarkMode: false,
  projects: initialProjects,
  quickLinks: [],
  notes: '',
  todos: [],

  isAddProjectModalOpen: false,
  isAddCollectionModalOpen: false,
  isAddLinkModalOpen: false,
  editingCollectionIdForLink: null,

  setActiveProject: (id) => set({ activeProjectId: id }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
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
}));
