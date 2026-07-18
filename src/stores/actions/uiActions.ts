import { nanoid } from 'nanoid';
import type {
  QuickLink,
  ChromeWindowInfo,
  VerticalTabId,
  ChromeTabInfo,
} from '@/types';
import type { ActiveViewType, AppState } from '../types';
import type { LegacyTask } from '@/types/tasks';
import { getAllWindows } from '@/lib/tabService';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildTodoPatch } from '@/lib/cloudflareSync/entityPatches';
import type { StoreApi } from 'zustand';

const generateId = () => nanoid();

export const createUIActions = (
  set: StoreApi<AppState>['setState'],
  get: () => AppState
) => ({
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

  detectSystemTheme: () => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
      set({ isDarkMode: mediaQuery.matches });
      if (mediaQuery.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    updateTheme();
    mediaQuery.addEventListener('change', updateTheme);
    // Return a cleanup function to be called on component unmount
    return () => mediaQuery.removeEventListener('change', updateTheme);
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

  // Todos actions
  addTodo: (text: string, category?: string) => {
    const state = get();
    const newTodo: LegacyTask = {
      id: generateId(),
      text,
      completed: false,
      category,
      // Strict per-project: every new todo belongs to the active project.
      projectId: state.activeProjectId ?? state.projects[0]?.id,
    };

    set((state: AppState) => ({
      todos: [...state.todos, newTodo],
    }));

    // Enqueue a todo create for cloud projects (no-op for local-only todos).
    if (newTodo.projectId) {
      void enqueueCloudChange({
        projectId: newTodo.projectId,
        entityType: 'todo',
        entityId: newTodo.id,
        operation: 'create',
        patch: buildTodoPatch(newTodo),
      });
    }
  },

  toggleTodo: (id: string) => {
    set((state: AppState) => ({
      todos: state.todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      ),
    }));

    // Enqueue the todo's full current payload (the backend replaces payload_json
    // wholesale, so read the merged todo after the optimistic update).
    const updated = get().todos.find((t) => t.id === id);
    if (updated?.projectId) {
      void enqueueCloudChange({
        projectId: updated.projectId,
        entityType: 'todo',
        entityId: id,
        operation: 'update',
        patch: buildTodoPatch(updated),
      });
    }
  },

  removeTodo: (id: string) => {
    // Capture the owning project before removal so the cloud delete can enqueue.
    const todo = get().todos.find((t) => t.id === id);

    set((state: AppState) => ({
      todos: state.todos.filter((t) => t.id !== id),
    }));

    if (todo?.projectId) {
      void enqueueCloudChange({
        projectId: todo.projectId,
        entityType: 'todo',
        entityId: id,
        operation: 'delete',
        patch: {},
      });
    }
  },

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

  // Onboarding actions
  openOnboarding: () =>
    set((state: AppState) => ({
      ...state,
      isOnboardingOpen: true,
    })),
  closeOnboarding: () =>
    set((state: AppState) => ({
      ...state,
      isOnboardingOpen: false,
    })),
  completeOnboarding: () =>
    set((state: AppState) => ({
      ...state,
      isOnboardingOpen: false,
      hasCompletedOnboarding: true,
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
