import type {
  Project,
  Collection,
  Link,
  QuickLink,
  ChromeWindowInfo,
  ChromeTabInfo,
  VerticalTabId,
} from '@/types';
import type {
  AdvancedTask,
  TaskTemplate,
  TaskViewSettings,
  TaskStats,
  PomodoroSession,
  TaskBulkOperation,
  LegacyTask,
} from '@/types/tasks';
import type {
  CloudPresenceUser,
  CloudRole,
  CloudSyncChange,
  CloudSyncState,
} from '@/lib/cloudflareSync/types';

// Define ActiveViewType
export type ActiveViewType =
  | 'projectDetail'
  | 'settings'
  | 'tasks'
  | 'notes'
  | 'todos';

export type SearchFilter = {
  projects: boolean;
  collections: boolean;
  links: boolean;
};

export type SortOption = 'name' | 'date';

export interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;
  /** Project this note belongs to. Older notes are stamped at rehydrate. */
  projectId?: string;
}

export interface AppState {
  // UI State
  activeProjectId: string | null;
  activeView: ActiveViewType;
  isDarkMode: boolean;
  searchQuery: string;
  searchFilters: SearchFilter;
  sortOption: SortOption;
  themeColor: string;

  // New Right Panel State
  activeVerticalTabId: VerticalTabId | null;
  isRightContentPanelOpen: boolean;

  // Sidebar State
  isSidebarOpen: boolean;
  isSidebarLoaded: boolean;

  // Data
  projects: Project[];
  tabManagerRootFolderId: string | null;
  chromeWindows: ChromeWindowInfo[];
  quickLinks: QuickLink[];
  notes: Note[];
  // Legacy todos for backward compatibility
  todos: LegacyTask[];
  // Enhanced task management
  tasks: AdvancedTask[];
  taskTemplates: TaskTemplate[];
  taskViewSettings: TaskViewSettings;
  taskStats: TaskStats;
  pomodoroSessions: PomodoroSession[];
  activeTaskId: string | null;
  activePomodoroSession: PomodoroSession | null;

  // Modal States
  isAddProjectModalOpen: boolean;
  isAddCollectionModalOpen: boolean;
  isAddLinkModalOpen: boolean;
  isEditLinkModalOpen: boolean;
  editingCollectionIdForLink: string | null;
  editingCollectionId: string | null;
  editingLinkId: string | null;

  // Cloud sync state
  cloudSync: CloudSyncState;

  // Hydration state
  _hasHydrated: boolean;
  _themeFromStorage: boolean;

  // Actions
  setHasHydrated: (hydrated: boolean) => void;
  setActiveProject: (id: string | null) => void;
  toggleDarkMode: () => void;
  setSearchQuery: (query: string) => void;
  setSearchFilters: (filters: Partial<SearchFilter>) => void;
  setSortOption: (option: SortOption) => void;
  setThemeColor: (color: string) => void;
  detectSystemTheme: () => () => void;

  // New Right Panel Actions
  setActiveVerticalTabId: (tabId: VerticalTabId | null) => void;
  toggleRightContentPanel: (forceOpen?: boolean, tabId?: VerticalTabId) => void;

  // Sidebar Actions
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  setSidebarLoaded: (loaded: boolean) => void;
  initializeSidebarState: (defaultOpen?: boolean) => Promise<void>;

  // Project actions
  setTabManagerRootFolderId: (id: string | null) => void;
  syncBookmarks: () => Promise<void>;
  addProject: (
    projectData: Pick<Project, 'name' | 'color' | 'description' | 'icon'>,
    options?: {
      /** Skip creating a Chrome bookmark folder (e.g. cloud projects, import). */
      skipBookmarkCreation?: boolean;
      /** Use a server-assigned id for cloud projects instead of a fresh nanoid. */
      id?: string;
      /** Mark the project as cloud-synced. */
      cloudEnabled?: boolean;
      /** The current user's role on a cloud project (Phase 4). */
      cloudRole?: CloudRole;
    }
  ) => void;
  updateProject: (
    id: string,
    updates: Partial<Project>,
    isInternalCall?: boolean
  ) => void;
  deleteProject: (id: string) => void;
  moveProject: (projectId: string, direction: 'up' | 'down') => void;
  reorderProjects: (activeId: string, overId: string) => void;
  migrateProjectOrder: () => void;

  // Cloud sync actions
  setCloudSyncState: (patch: Partial<Omit<CloudSyncState, 'cursors'>>) => void;
  setProjectCursor: (projectId: string, cursor: number) => void;
  clearProjectCursor: (projectId: string) => void;
  clearProjectCursors: () => void;
  mergeRemoteChanges: (changes: CloudSyncChange[], clientId: string) => void;
  /** Whether the active project's realtime socket is connected (Phase 5). */
  setRealtimeConnected: (connected: boolean) => void;
  /** Members currently connected to the active project's realtime room. */
  setOnlinePresence: (users: CloudPresenceUser[]) => void;
  /** Toggle a project's cloud-synced flag (used by convert/disconnect). */
  setProjectCloudEnabled: (projectId: string, enabled: boolean) => void;
  /** Set the current user's role on a cloud project (Phase 4 role refresh). */
  setProjectCloudRole: (projectId: string, role: CloudRole) => void;
  /**
   * Re-key a local project to its server-assigned id and mark it cloud-enabled.
   * Used by convertProjectToCloud after POST /projects returns the server id.
   * Entity ids (collections/links) are unchanged since they are client-authoritative.
   */
  convertProjectToCloudState: (
    localId: string,
    serverProjectId: string
  ) => void;

  // Collection actions
  addCollection: (
    projectId: string,
    collectionData: Pick<Collection, 'name' | 'description' | 'color'>,
    skipBookmarkCreation?: boolean
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
  toggleAllCollections: (projectId: string, isExpanded: boolean) => void;
  migrateCollectionOrder: (projectId: string) => void;

  // Link actions
  addLink: (
    projectId: string,
    collectionId: string,
    linkData: Pick<Link, 'title' | 'url' | 'favIconUrl' | 'tags' | 'notes'>,
    skipBookmarkCreation?: boolean
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
  addNote: (title: string, content: string, color?: string) => void;
  updateNote: (
    id: string,
    updates: Partial<Omit<Note, 'id' | 'createdAt'>>
  ) => void;
  deleteNote: (id: string) => void;
  togglePinNote: (id: string) => void;
  duplicateNote: (id: string) => void;

  // Legacy Todos actions (for backward compatibility)
  addTodo: (text: string, category?: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;

  // Enhanced Task Management Actions
  // Task CRUD
  addTask: (
    task: Omit<AdvancedTask, 'id' | 'createdAt' | 'updatedAt' | 'activities'>
  ) => void;
  updateTask: (id: string, updates: Partial<AdvancedTask>) => void;
  deleteTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  archiveTask: (id: string) => void;
  unarchiveTask: (id: string) => void;

  // Task Status & Progress
  setTaskStatus: (id: string, status: AdvancedTask['status']) => void;
  setTaskPriority: (id: string, priority: AdvancedTask['priority']) => void;
  setTaskProgress: (id: string, progress: number) => void;
  completeTask: (id: string) => void;

  // Subtask Management
  addSubtask: (
    parentId: string,
    subtask: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities' | 'parentTaskId'
    >
  ) => void;
  removeSubtask: (parentId: string, subtaskId: string) => void;
  moveSubtask: (subtaskId: string, newParentId: string) => void;

  // Task Organization
  addTaskTag: (id: string, tag: string) => void;
  removeTaskTag: (id: string, tag: string) => void;
  setTaskCategory: (id: string, category: string) => void;
  assignTaskToProject: (
    id: string,
    projectId: string,
    collectionId?: string
  ) => void;

  // Task Templates
  addTaskTemplate: (template: Omit<TaskTemplate, 'id' | 'createdAt'>) => void;
  updateTaskTemplate: (id: string, updates: Partial<TaskTemplate>) => void;
  deleteTaskTemplate: (id: string) => void;
  createTaskFromTemplate: (
    templateId: string,
    overrides?: Partial<AdvancedTask>
  ) => void;

  // Task Views & Filtering
  setTaskViewMode: (mode: TaskViewSettings['mode']) => void;
  setTaskFilters: (filters: Partial<TaskViewSettings['filters']>) => void;
  setTaskSort: (sort: TaskViewSettings['sortBy']) => void;
  setTaskGroupBy: (groupBy: TaskViewSettings['groupBy']) => void;
  toggleShowCompleted: () => void;
  toggleShowArchived: () => void;
  toggleCompactMode: () => void;

  // Bulk Operations
  performBulkOperation: (operation: TaskBulkOperation) => void;
  selectTask: (id: string, selected: boolean) => void;
  selectAllTasks: (selected: boolean) => void;
  getSelectedTasks: () => string[];

  // Time Management
  startPomodoroSession: (taskId: string, duration?: number) => void;
  pausePomodoroSession: () => void;
  resumePomodoroSession: () => void;
  completePomodoroSession: () => void;
  cancelPomodoroSession: () => void;

  // Task Analytics
  refreshTaskStats: () => void;
  getTasksByStatus: (status: AdvancedTask['status']) => AdvancedTask[];
  getTasksByPriority: (priority: AdvancedTask['priority']) => AdvancedTask[];
  getOverdueTasks: () => AdvancedTask[];
  getTasksForProject: (projectId: string) => AdvancedTask[];

  // Task Comments & Activities
  addTaskComment: (taskId: string, content: string, author: string) => void;
  updateTaskComment: (
    taskId: string,
    commentId: string,
    content: string
  ) => void;
  deleteTaskComment: (taskId: string, commentId: string) => void;
  addTaskActivity: (
    taskId: string,
    activity: Omit<AdvancedTask['activities'][0], 'id' | 'timestamp'>
  ) => void;

  // Task Search & Discovery
  searchTasks: (query: string) => AdvancedTask[];
  getRecentTasks: (limit?: number) => AdvancedTask[];
  getFavoriteTasks: () => AdvancedTask[];
  toggleTaskFavorite: (id: string) => void;

  // Active Task Management
  setActiveTask: (id: string | null) => void;
  getActiveTask: () => AdvancedTask | null;

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
  refreshChromeWindows: () => Promise<void>;
  setChromeWindows: (windows: ChromeWindowInfo[]) => void;
  renameChromeWindow: (windowId: number, newName: string) => void;
  updateChromeTab: (tabId: number, updatedTab: ChromeTabInfo) => void;
  addChromeTab: (windowId: number, newTab: ChromeTabInfo) => void;
  removeChromeTab: (tabId: number) => void;
  addChromeWindowToCollections: (windowInfo: ChromeWindowInfo) => void;

  // Drag & Drop actions
  moveLink: (
    projectId: string,
    sourceCollectionId: string,
    linkId: string,
    targetCollectionId: string,
    position?: number
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
