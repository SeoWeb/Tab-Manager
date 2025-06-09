import { nanoid } from 'nanoid';
import type {
  QuickLink,
  ChromeWindowInfo,
  VerticalTabId,
  ChromeTabInfo,
} from '@/types';
import type { ActiveViewType, AppState } from '../types';
import { getAllWindows } from '@/lib/tabService';

const generateId = () => nanoid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createUIActions = (set: any, get: () => AppState) => ({
  setHasHydrated: (hydrated: boolean) =>
    set((state: AppState) => ({
      ...state,
      _hasHydrated: hydrated,
    })),

  setActiveProject: (id: string | null) =>
    set((state: AppState) => ({
      ...state,
      activeProjectId: id,
      activeView: id ? 'projectDetail' : get().activeView,
    })),

  setActiveView: (view: ActiveViewType) =>
    set((state: AppState) => ({
      ...state,
      activeView: view,
    })),

  toggleDarkMode: () => {
    set((state: AppState) => {
      // Add safety check for state
      if (!state) return { isDarkMode: false };

      const currentIsDarkMode = state.isDarkMode ?? false;
      const newIsDarkMode = !currentIsDarkMode;

      if (newIsDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { isDarkMode: newIsDarkMode };
    });
  },

  setActiveVerticalTabId: (tabId: VerticalTabId | null) =>
    set((state: AppState) => ({
      ...state,
      activeVerticalTabId: tabId,
    })),

  toggleRightContentPanel: (forceOpen?: boolean, tabId?: VerticalTabId) =>
    set((state: AppState) => {
      let newOpenState =
        forceOpen !== undefined ? forceOpen : !state.isRightContentPanelOpen;
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

  // Quick Links actions
  addQuickLink: (link: Omit<QuickLink, 'id'>) =>
    set((state: AppState) => ({
      quickLinks: [...state.quickLinks, { ...link, id: generateId() }],
    })),

  removeQuickLink: (id: string) =>
    set((state: AppState) => ({
      quickLinks: state.quickLinks.filter((l: QuickLink) => l.id !== id),
    })),

  // Notes actions
  updateNotes: (notes: string) =>
    set((state: AppState) => ({
      ...state,
      notes: notes,
    })),

  // Todos actions
  addTodo: (text: string) =>
    set((state: AppState) => ({
      todos: [...state.todos, { id: generateId(), text, completed: false }],
    })),

  toggleTodo: (id: string) =>
    set((state: AppState) => ({
      todos: state.todos.map(
        (todo: { id: string; text: string; completed: boolean }) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo
      ),
    })),

  removeTodo: (id: string) =>
    set((state: AppState) => ({
      todos: state.todos.filter(
        (todo: { id: string; text: string; completed: boolean }) =>
          todo.id !== id
      ),
    })),

  // Modal actions
  openAddProjectModal: () =>
    set((state: AppState) => ({
      ...state,
      isAddProjectModalOpen: true,
    })),
  closeAddProjectModal: () =>
    set((state: AppState) => ({
      ...state,
      isAddProjectModalOpen: false,
    })),
  openAddCollectionModal: () =>
    set((state: AppState) => ({
      ...state,
      isAddCollectionModalOpen: true,
    })),
  closeAddCollectionModal: () =>
    set((state: AppState) => ({
      ...state,
      isAddCollectionModalOpen: false,
    })),
  openAddLinkModal: (collectionId: string) =>
    set((state: AppState) => ({
      ...state,
      isAddLinkModalOpen: true,
      editingCollectionIdForLink: collectionId,
    })),
  closeAddLinkModal: () =>
    set((state: AppState) => ({
      ...state,
      isAddLinkModalOpen: false,
      editingCollectionIdForLink: null,
    })),

  openEditLinkModal: (collectionId: string, linkId: string) =>
    set((state: AppState) => ({
      ...state,
      isEditLinkModalOpen: true,
      editingCollectionId: collectionId,
      editingLinkId: linkId,
    })),
  closeEditLinkModal: () =>
    set((state: AppState) => ({
      ...state,
      isEditLinkModalOpen: false,
      editingCollectionId: null,
      editingLinkId: null,
    })),

  // Chrome Windows/Tabs actions
  refreshChromeWindows: async () => {
    try {
      const windows = await getAllWindows();
      set((state: AppState) => ({
        ...state,
        chromeWindows: windows,
      }));
    } catch (error) {
      console.error('Error refreshing Chrome windows:', error);
    }
  },

  setChromeWindows: (windows: ChromeWindowInfo[]) =>
    set((state: AppState) => ({
      ...state,
      chromeWindows: windows,
    })),

  renameChromeWindow: (windowId: number, newName: string) =>
    set((state: AppState) => ({
      chromeWindows: state.chromeWindows.map((win: ChromeWindowInfo) =>
        win.id === windowId ? { ...win, name: newName } : win
      ),
    })),

  updateChromeTab: (tabId: number, updatedTab: ChromeTabInfo) =>
    set((state: AppState) => ({
      chromeWindows: state.chromeWindows.map((window: ChromeWindowInfo) => ({
        ...window,
        tabs: window.tabs.map((tab: ChromeTabInfo) =>
          tab.id === tabId ? { ...tab, ...updatedTab } : tab
        ),
      })),
    })),

  addChromeTab: (windowId: number, newTab: ChromeTabInfo) =>
    set((state: AppState) => ({
      chromeWindows: state.chromeWindows.map((window: ChromeWindowInfo) =>
        window.id === windowId
          ? { ...window, tabs: [...window.tabs, newTab] }
          : window
      ),
    })),

  removeChromeTab: (tabId: number) =>
    set((state: AppState) => ({
      chromeWindows: state.chromeWindows.map((window: ChromeWindowInfo) => ({
        ...window,
        tabs: window.tabs.filter((tab: ChromeTabInfo) => tab.id !== tabId),
      })),
    })),

  addChromeWindowToCollections: (windowInfo: ChromeWindowInfo) => {
    const activeProjectId = get().activeProjectId;
    if (!activeProjectId) {
      console.warn('No active project to add collection to.');
      return;
    }

    const newCollectionName = windowInfo.name || `Window ${windowInfo.id} Tabs`;

    // First create the collection
    get().addCollection(activeProjectId, {
      name: newCollectionName,
    });

    // Find the newly created collection to add links to it
    setTimeout(() => {
      const state = get();
      const project = state.projects.find((p) => p.id === activeProjectId);
      if (!project) return;

      const newCollection = project.collections.find(
        (c) => c.name === newCollectionName
      );
      if (!newCollection) return;

      // Add each tab as a link to the collection
      windowInfo.tabs.forEach((tab) => {
        get().addLink(activeProjectId, newCollection.id, {
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
        });
      });
    }, 100); // Small delay to ensure collection is created
  },
});
