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
import { bookmarkService } from '@/lib/bookmarkService'; // Added import

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

export const TAB_MANAGER_ROOT_FOLDER_NAME = 'Tab Manager Projects'; // Added constant

export interface AppState {
  // UI State
  activeProjectId: string | null;
  activeView: ActiveViewType; // Added activeView
  isDarkMode: boolean;

  // New Right Panel State
  activeVerticalTabId: VerticalTabId | null;
  isRightContentPanelOpen: boolean;

  // Data
  projects: Project[];
  tabManagerRootFolderId: string | null; // Added state for root folder ID
  chromeWindows: ChromeWindowInfo[]; // For "Open Tabs" feature
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
  _hasHydrated: boolean; // Added hydration flag

  // Actions
  setHasHydrated: (hydrated: boolean) => void; // Added action for hydration
  setActiveProject: (id: string | null) => void;
  toggleDarkMode: () => void;

  // New Right Panel Actions
  setActiveVerticalTabId: (tabId: VerticalTabId | null) => void;
  toggleRightContentPanel: (forceOpen?: boolean, tabId?: VerticalTabId) => void;

  // Project actions
  initializeTabManagerRootFolder: () => Promise<void>; // Added action
  addProject: (
    // Adjusted based on previous findings for AddProjectModal
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>
  ) => void;
  updateProject: (
    id: string,
    updates: Partial<Project>,
    isInternalCall?: boolean
  ) => void; // Added isInternalCall
  deleteProject: (id: string) => void;

  // Collection actions
  addCollection: (
    // Renamed from addCollectionToProject for consistency with existing, payload adjusted
    projectId: string,
    collectionData: Pick<Collection, 'name' | 'description' | 'color'> // Adjusted payload
  ) => void;
  updateCollection: (
    projectId: string,
    collectionId: string,
    updates: Partial<Collection>,
    isInternalCall?: boolean // Added isInternalCall
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
    // Renamed from addLinkToCollection, payload adjusted
    projectId: string,
    collectionId: string,
    linkData: Pick<Link, 'title' | 'url' | 'favIconUrl' | 'tags' | 'notes'> // Adjusted payload, 'title' for name
  ) => void;
  updateLink: (
    projectId: string,
    collectionId: string,
    linkId: string,
    updates: Partial<Link>,
    isInternalCall?: boolean // Added isInternalCall
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
  openEditLinkModal: (collectionId: string, linkId: string) => void;
  closeEditLinkModal: () => void;

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
      isEditLinkModalOpen: false,
      editingCollectionIdForLink: null,
      editingCollectionId: null,
      editingLinkId: null,
      tabManagerRootFolderId: null, // Initial state for root folder ID
      _hasHydrated: false, // Initial hydration state

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          activeView: id ? 'projectDetail' : get().activeView,
        }),
      setActiveView: (view: ActiveViewType) => set({ activeView: view }),
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

      initializeTabManagerRootFolder: async () => {
        let currentRootId = get().tabManagerRootFolderId;

        // Check if existing ID is valid
        if (currentRootId) {
          const existingFolder =
            await bookmarkService.getBookmarkNode(currentRootId);
          if (
            existingFolder &&
            existingFolder.title === TAB_MANAGER_ROOT_FOLDER_NAME &&
            !existingFolder.url
          ) {
            // Check it's a folder
            console.log(
              'Tab Manager root folder already exists and ID is valid:',
              currentRootId
            );
            return;
          }
          console.log(
            'Previous Tab Manager root folder ID is invalid or folder mismatch. Re-searching/creating.'
          );
          currentRootId = null;
        }

        const parentIdForRoot = '2'; // "Other Bookmarks"
        try {
          const childrenOfOtherBookmarks =
            await bookmarkService.getChildren(parentIdForRoot);
          const foundFolder = childrenOfOtherBookmarks.find(
            (node) => node.title === TAB_MANAGER_ROOT_FOLDER_NAME && !node.url
          );

          if (foundFolder) {
            console.log(
              'Found existing Tab Manager root folder:',
              foundFolder.id
            );
            get().setHasHydrated(true);
          } else {
            console.log(
              `"${TAB_MANAGER_ROOT_FOLDER_NAME}" folder not found, creating under "Other Bookmarks"...`
            );
            const newFolder = await bookmarkService.createBookmarkFolder(
              TAB_MANAGER_ROOT_FOLDER_NAME,
              parentIdForRoot
            );
            console.log('Created Tab Manager root folder:', newFolder.id);
            get().setHasHydrated(true);
          }
        } catch (error) {
          console.error('Error initializing Tab Manager root folder:', error);
          get().setHasHydrated(true);
        }
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
              newActiveTabId = null;
            } else {
              // Clicking a new tab or opening the panel
              newOpenState = true;
              newActiveTabId = tabId;
            }
          } else if (forceOpen === false) {
            // Generic close
            newActiveTabId = null;
          }

          return {
            isRightContentPanelOpen: newOpenState,
            activeVerticalTabId: newActiveTabId,
          };
        }),

      addProject: (projectData) => {
        set((state) => {
          const newProject: Project = {
            id: generateId(),
            name: projectData.name,
            description: projectData.description || '',
            color: projectData.color || '#CCCCCC',
            icon: projectData.icon || '',
            collections: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            bookmarkFolderId: null, // Initialize with null
          };

          // Asynchronous part for bookmark creation
          (async () => {
            const rootFolderId = useAppStore.getState().tabManagerRootFolderId;
            if (rootFolderId) {
              try {
                const newBookmarkFolder =
                  await bookmarkService.createBookmarkFolder(
                    newProject.name,
                    rootFolderId
                  );
                // Update the project in the store with the bookmarkFolderId
                useAppStore
                  .getState()
                  .updateProject(
                    newProject.id,
                    { bookmarkFolderId: newBookmarkFolder.id },
                    true
                  );
              } catch (error) {
                console.error(
                  `Failed to create bookmark folder for project ${newProject.name}:`,
                  error
                );
              }
            } else {
              console.warn(
                'Tab Manager root bookmark folder ID not found. Cannot create project bookmark folder.'
              );
            }
          })();

          return { projects: [...state.projects, newProject] };
        });
      },
      updateProject: (id, updates, isInternalCall = false) => {
        set((state) => {
          const projectToUpdate = state.projects.find((p) => p.id === id);
          if (!projectToUpdate) return state; // Should not happen if ID is correct

          const oldName = projectToUpdate.name;
          const newName = updates.name;

          const updatedProjects = state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
          );

          // Asynchronous part for bookmark update
          if (
            !isInternalCall &&
            newName &&
            newName !== oldName &&
            projectToUpdate.bookmarkFolderId
          ) {
            (async () => {
              try {
                await bookmarkService.updateBookmark(
                  projectToUpdate.bookmarkFolderId!,
                  { title: newName }
                );
                console.log(
                  `Bookmark folder for project ${id} renamed to ${newName}`
                );
              } catch (error) {
                console.error(
                  `Failed to update bookmark folder name for project ${id}:`,
                  error
                );
              }
            })();
          }
          return { projects: updatedProjects };
        });
      },
      deleteProject: (id) => {
        set((state) => {
          const projectToDelete = state.projects.find((p) => p.id === id);
          const updatedProjects = state.projects.filter((p) => p.id !== id);
          let newActiveProjectId = state.activeProjectId;

          if (state.activeProjectId === id) {
            newActiveProjectId =
              updatedProjects.length > 0 ? updatedProjects[0].id : null;
          }

          // Asynchronous part for bookmark deletion
          if (projectToDelete && projectToDelete.bookmarkFolderId) {
            (async () => {
              try {
                await bookmarkService.deleteBookmarkTree(
                  projectToDelete.bookmarkFolderId!
                );
                console.log(`Bookmark folder for project ${id} deleted.`);
              } catch (error) {
                console.error(
                  `Failed to delete bookmark folder for project ${id}:`,
                  error
                );
              }
            })();
          }
          return {
            projects: updatedProjects,
            activeProjectId: newActiveProjectId,
          };
        });
      },

      addCollection: (projectId, collectionData) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) {
            console.error(
              `Project with ID ${projectId} not found for adding collection.`
            );
            return state;
          }

          const newCollection: Collection = {
            id: generateId(),
            name: collectionData.name,
            description: collectionData.description || '',
            color: collectionData.color,
            links: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            minimized: false,
            order: project.collections.length,
            bookmarkFolderId: null,
          };

          if (project.bookmarkFolderId) {
            (async () => {
              try {
                const newBookmarkFolder =
                  await bookmarkService.createBookmarkFolder(
                    newCollection.name,
                    project.bookmarkFolderId!
                  );
                useAppStore.getState().updateCollection(
                  projectId,
                  newCollection.id,
                  { bookmarkFolderId: newBookmarkFolder.id },
                  true // isInternalCall
                );
              } catch (error) {
                console.error(
                  `Failed to create bookmark folder for collection ${newCollection.name}:`,
                  error
                );
              }
            })();
          } else {
            console.warn(
              `Project ${projectId} does not have a bookmarkFolderId. Cannot create collection bookmark folder.`
            );
          }

          const updatedProjects = state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  collections: [...p.collections, newCollection],
                  updatedAt: new Date(),
                }
              : p
          );
          return { projects: updatedProjects };
        });
      },
      updateCollection: (
        projectId,
        collectionId,
        updates,
        isInternalCall = false
      ) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) return state;
          const collectionToUpdate = project.collections.find(
            (c) => c.id === collectionId
          );
          if (!collectionToUpdate) return state;

          const oldName = collectionToUpdate.name;
          const newName = updates.name;

          const updatedProjects = state.projects.map((p) => {
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
          });

          if (
            !isInternalCall &&
            newName &&
            newName !== oldName &&
            collectionToUpdate.bookmarkFolderId
          ) {
            (async () => {
              try {
                await bookmarkService.updateBookmark(
                  collectionToUpdate.bookmarkFolderId!,
                  { title: newName }
                );
                console.log(
                  `Bookmark folder for collection ${collectionId} renamed to ${newName}`
                );
              } catch (error) {
                console.error(
                  `Failed to update bookmark folder name for collection ${collectionId}:`,
                  error
                );
              }
            })();
          }
          return { projects: updatedProjects };
        });
      },
      deleteCollection: (projectId, collectionId) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) return state;
          const collectionToDelete = project.collections.find(
            (c) => c.id === collectionId
          );

          const updatedProjects = state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.filter((c) => c.id !== collectionId),
                updatedAt: new Date(),
              };
            }
            return p;
          });

          if (collectionToDelete && collectionToDelete.bookmarkFolderId) {
            (async () => {
              try {
                await bookmarkService.deleteBookmarkTree(
                  collectionToDelete.bookmarkFolderId!
                );
                console.log(
                  `Bookmark folder for collection ${collectionId} deleted.`
                );
              } catch (error) {
                console.error(
                  `Failed to delete bookmark folder for collection ${collectionId}:`,
                  error
                );
              }
            })();
          }
          return { projects: updatedProjects };
        });
      },

      moveCollection: (projectId, collectionId, direction) => {
        set((state) => {
          const projectIndex = state.projects.findIndex(
            (p) => p.id === projectId
          );
          if (projectIndex === -1) return {};

          const project = state.projects[projectIndex];
          const collectionIndex = project.collections.findIndex(
            (c) => c.id === collectionId
          );
          if (collectionIndex === -1) return {};

          const newCollections = [...project.collections];
          const [movedCollection] = newCollections.splice(collectionIndex, 1);

          if (direction === 'up') {
            newCollections.splice(
              Math.max(0, collectionIndex - 1),
              0,
              movedCollection
            );
          } else {
            newCollections.splice(
              Math.min(newCollections.length, collectionIndex + 1),
              0,
              movedCollection
            );
          }

          const updatedProjects = [...state.projects];
          updatedProjects[projectIndex] = {
            ...project,
            collections: newCollections,
          };

          return { projects: updatedProjects };
        });
      },

      openCollectionInNewWindow: (projectId, collectionId) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return;

        const collection = project.collections.find(
          (c) => c.id === collectionId
        );
        if (!collection || collection.links.length === 0) return;

        const urls = collection.links.map((link) => link.url);
        chrome.windows.create({ url: urls });
      },

      addLink: (projectId, collectionId, linkData) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) return state;
          const collection = project.collections.find(
            (c) => c.id === collectionId
          );
          if (!collection) return state;

          const newLink: Link = {
            id: generateId(),
            title: linkData.title || 'Untitled Link', // Use title from input
            url: linkData.url,
            favIconUrl: linkData.favIconUrl || '',
            tags: linkData.tags || [],
            notes: linkData.notes || '',
            createdAt: new Date(),
            order: collection.links.length,
            bookmarkId: null,
          };

          if (collection.bookmarkFolderId) {
            (async () => {
              try {
                const newBookmark = await bookmarkService.createBookmark(
                  collection.bookmarkFolderId!,
                  newLink.title!, // title should be defined
                  newLink.url
                );
                useAppStore.getState().updateLink(
                  projectId,
                  collectionId,
                  newLink.id,
                  { bookmarkId: newBookmark.id },
                  true // isInternalCall
                );
              } catch (error) {
                console.error(
                  `Failed to create bookmark for link ${newLink.title}:`,
                  error
                );
              }
            })();
          } else {
            console.warn(
              `Collection ${collectionId} does not have a bookmarkFolderId. Cannot create link bookmark.`
            );
          }

          const updatedProjects = state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) => {
                  if (c.id === collectionId) {
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
          });
          return { projects: updatedProjects };
        });
      },
      updateLink: (
        projectId,
        collectionId,
        linkId,
        updates,
        isInternalCall = false
      ) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) return state;
          const collection = project.collections.find(
            (c) => c.id === collectionId
          );
          if (!collection) return state;
          const linkToUpdate = collection.links.find((l) => l.id === linkId);
          if (!linkToUpdate) return state;

          const oldTitle = linkToUpdate.title;
          const newTitle = updates.title;
          const oldUrl = linkToUpdate.url;
          const newUrl = updates.url;

          const updatedProjects = state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                collections: p.collections.map((c) => {
                  if (c.id === collectionId) {
                    return {
                      ...c,
                      links: c.links.map(
                        (l) => (l.id === linkId ? { ...l, ...updates } : l) // Assuming Link has updatedAt, or handle it here
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
          });

          if (
            !isInternalCall &&
            linkToUpdate.bookmarkId &&
            ((newTitle && newTitle !== oldTitle) ||
              (newUrl && newUrl !== oldUrl))
          ) {
            (async () => {
              try {
                await bookmarkService.updateBookmark(linkToUpdate.bookmarkId!, {
                  title: newTitle || oldTitle,
                  url: newUrl || oldUrl,
                });
                console.log(`Bookmark for link ${linkId} updated.`);
              } catch (error) {
                console.error(
                  `Failed to update bookmark for link ${linkId}:`,
                  error
                );
              }
            })();
          }
          return { projects: updatedProjects };
        });
      },
      deleteLink: (projectId, collectionId, linkId) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId);
          if (!project) return state;
          const collection = project.collections.find(
            (c) => c.id === collectionId
          );
          if (!collection) return state;
          const linkToDelete = collection.links.find((l) => l.id === linkId);

          const updatedProjects = state.projects.map((p) => {
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
          });

          if (linkToDelete && linkToDelete.bookmarkId) {
            (async () => {
              try {
                await bookmarkService.deleteBookmark(linkToDelete.bookmarkId!); // Not deleteBookmarkTree
                console.log(`Bookmark for link ${linkId} deleted.`);
              } catch (error) {
                console.error(
                  `Failed to delete bookmark for link ${linkId}:`,
                  error
                );
              }
            })();
          }
          return { projects: updatedProjects };
        });
      },

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

      openEditLinkModal: (collectionId, linkId) =>
        set({
          isEditLinkModalOpen: true,
          editingCollectionId: collectionId,
          editingLinkId: linkId,
        }),
      closeEditLinkModal: () =>
        set({
          isEditLinkModalOpen: false,
          editingCollectionId: null,
          editingLinkId: null,
        }),

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

        // const newLinks: Link[] = windowInfo.tabs.map((tab, index) => ({
        //   id: generateId(),
        //   url: tab.url || '',
        //   title: tab.title || 'Untitled Tab',
        //   favIconUrl: tab.favIconUrl || '',
        //   createdAt: new Date(),
        //   order: index,
        //   tags: [],
        //   notes: '',
        // }));

        get().addCollection(activeProjectId, {
          name: windowInfo.name || 'New Window Collection',
          // links: newLinks, // This needs to be handled separately, as addCollection doesn't accept links directly.
        });
        // TODO: After the collection is created, add the links to it.
        // This might require a new action or modifying addCollection to return the new collection's ID.
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
        tabManagerRootFolderId: state.tabManagerRootFolderId,
        // _hasHydrated: state._hasHydrated, // Typically, _hasHydrated itself doesn't need to be persisted.
        // It's a transient state for coordinating actions post-hydration.
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate state from storage:', error);
        }
        // Zustand's types for `state` in `onRehydrateStorage` might be `Partial<S> | undefined`.
        // We call setHasHydrated on the store instance itself.
        useAppStore.getState().setHasHydrated(true);

        // Apply dark mode on load if the state was rehydrated and contains isDarkMode
        if (state?.isDarkMode) {
          document.documentElement.classList.add('dark');
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
