// src/lib/bookmarkSyncService.ts

import { bookmarkService } from './bookmarkService';
import { useAppStore, TAB_MANAGER_ROOT_FOLDER_NAME } from '@/stores/appStore';
import type { Project, Collection, Link } from '@/types';

/**
 * Service for bidirectional bookmark synchronization
 * Handles syncing changes from Chrome bookmarks back to the extension
 */
export class BookmarkSyncService {
  private isInitialized = false;
  private syncInProgress = false;

  /**
   * Initialize the bookmark sync service
   * Sets up event listeners for bookmark changes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Set up Chrome bookmark event listeners
      if (chrome.bookmarks) {
        chrome.bookmarks.onCreated.addListener(this.handleBookmarkCreated.bind(this));
        chrome.bookmarks.onRemoved.addListener(this.handleBookmarkRemoved.bind(this));
        chrome.bookmarks.onChanged.addListener(this.handleBookmarkChanged.bind(this));
        chrome.bookmarks.onMoved.addListener(this.handleBookmarkMoved.bind(this));
      }

      this.isInitialized = true;
      console.log('BookmarkSyncService initialized');
    } catch (error) {
      console.error('Failed to initialize BookmarkSyncService:', error);
    }
  }

  /**
   * Perform a full sync from bookmarks to extension data
   * This reconciles any differences between bookmarks and extension state
   */
  async performFullSync(): Promise<void> {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    console.log('Starting full bookmark sync...');

    try {
      const store = useAppStore.getState();
      const rootFolderId = store.tabManagerRootFolderId;

      if (!rootFolderId) {
        console.warn('No root folder ID found, cannot perform sync');
        return;
      }

      // Get all bookmark folders under the root
      const rootChildren = await bookmarkService.getChildren(rootFolderId);
      const projectFolders = rootChildren.filter(node => !node.url); // Only folders

      // Sync projects
      await this.syncProjects(projectFolders);

      console.log('Full bookmark sync completed');
    } catch (error) {
      console.error('Error during full sync:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync projects from bookmark folders
   */
  private async syncProjects(bookmarkProjectFolders: chrome.bookmarks.BookmarkTreeNode[]): Promise<void> {
    const store = useAppStore.getState();
    const currentProjects = store.projects;

    // Find projects that exist in bookmarks but not in extension
    for (const bookmarkFolder of bookmarkProjectFolders) {
      const existingProject = currentProjects.find(p => p.bookmarkFolderId === bookmarkFolder.id);
      
      if (!existingProject) {
        // Create new project from bookmark folder
        await this.createProjectFromBookmark(bookmarkFolder);
      } else {
        // Sync existing project
        await this.syncProject(existingProject, bookmarkFolder);
      }
    }

    // Find projects that exist in extension but not in bookmarks (they were deleted)
    for (const project of currentProjects) {
      if (project.bookmarkFolderId) {
        const bookmarkExists = bookmarkProjectFolders.find(bf => bf.id === project.bookmarkFolderId);
        if (!bookmarkExists) {
          // Project's bookmark folder was deleted, remove project
          console.log(`Project "${project.name}" bookmark folder was deleted, removing project`);
          store.deleteProject(project.id);
        }
      }
    }
  }

  /**
   * Create a new project from a bookmark folder
   */
  private async createProjectFromBookmark(bookmarkFolder: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    console.log(`Creating project from bookmark folder: ${bookmarkFolder.title}`);
    
    const store = useAppStore.getState();
    
    // Create project with basic info
    const projectData = {
      name: bookmarkFolder.title || 'Untitled Project',
      description: `Imported from bookmarks`,
      color: '#4285F4', // Default color
      icon: bookmarkFolder.title ? bookmarkFolder.title.charAt(0).toUpperCase() : '📁'
    };

    store.addProject(projectData);

    // Find the newly created project and update its bookmark folder ID
    const projects = useAppStore.getState().projects;
    const newProject = projects.find(p => p.name === projectData.name && !p.bookmarkFolderId);
    
    if (newProject) {
      store.updateProject(newProject.id, { bookmarkFolderId: bookmarkFolder.id }, true);
      
      // Sync collections for this project
      const collectionFolders = await bookmarkService.getChildren(bookmarkFolder.id);
      await this.syncCollections(newProject.id, collectionFolders.filter(node => !node.url));
    }
  }

  /**
   * Sync an existing project with its bookmark folder
   */
  private async syncProject(project: Project, bookmarkFolder: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    const store = useAppStore.getState();

    // Check if project name changed in bookmarks
    if (project.name !== bookmarkFolder.title) {
      console.log(`Project name changed in bookmarks: "${project.name}" -> "${bookmarkFolder.title}"`);
      store.updateProject(project.id, { name: bookmarkFolder.title || project.name }, true);
    }

    // Sync collections
    const collectionFolders = await bookmarkService.getChildren(bookmarkFolder.id);
    await this.syncCollections(project.id, collectionFolders.filter(node => !node.url));
  }

  /**
   * Sync collections from bookmark subfolders
   */
  private async syncCollections(projectId: string, bookmarkCollectionFolders: chrome.bookmarks.BookmarkTreeNode[]): Promise<void> {
    const store = useAppStore.getState();
    const project = store.projects.find(p => p.id === projectId);
    if (!project) return;

    // Find collections that exist in bookmarks but not in extension
    for (const bookmarkFolder of bookmarkCollectionFolders) {
      const existingCollection = project.collections.find(c => c.bookmarkFolderId === bookmarkFolder.id);
      
      if (!existingCollection) {
        // Create new collection from bookmark folder
        await this.createCollectionFromBookmark(projectId, bookmarkFolder);
      } else {
        // Sync existing collection
        await this.syncCollection(projectId, existingCollection, bookmarkFolder);
      }
    }

    // Find collections that exist in extension but not in bookmarks (they were deleted)
    for (const collection of project.collections) {
      if (collection.bookmarkFolderId) {
        const bookmarkExists = bookmarkCollectionFolders.find(bf => bf.id === collection.bookmarkFolderId);
        if (!bookmarkExists) {
          // Collection's bookmark folder was deleted, remove collection
          console.log(`Collection "${collection.name}" bookmark folder was deleted, removing collection`);
          store.deleteCollection(projectId, collection.id);
        }
      }
    }
  }

  /**
   * Create a new collection from a bookmark folder
   */
  private async createCollectionFromBookmark(projectId: string, bookmarkFolder: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    console.log(`Creating collection from bookmark folder: ${bookmarkFolder.title}`);
    
    const store = useAppStore.getState();
    
    const collectionData = {
      name: bookmarkFolder.title || 'Untitled Collection',
      description: 'Imported from bookmarks',
      color: undefined
    };

    store.addCollection(projectId, collectionData);

    // Find the newly created collection and update its bookmark folder ID
    const updatedProject = useAppStore.getState().projects.find(p => p.id === projectId);
    const newCollection = updatedProject?.collections.find(c => c.name === collectionData.name && !c.bookmarkFolderId);
    
    if (newCollection) {
      store.updateCollection(projectId, newCollection.id, { bookmarkFolderId: bookmarkFolder.id }, true);
      
      // Sync links for this collection
      const bookmarkLinks = await bookmarkService.getChildren(bookmarkFolder.id);
      await this.syncLinks(projectId, newCollection.id, bookmarkLinks.filter(node => node.url));
    }
  }

  /**
   * Sync an existing collection with its bookmark folder
   */
  private async syncCollection(projectId: string, collection: Collection, bookmarkFolder: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    const store = useAppStore.getState();

    // Check if collection name changed in bookmarks
    if (collection.name !== bookmarkFolder.title) {
      console.log(`Collection name changed in bookmarks: "${collection.name}" -> "${bookmarkFolder.title}"`);
      store.updateCollection(projectId, collection.id, { name: bookmarkFolder.title || collection.name }, true);
    }

    // Sync links
    const bookmarkLinks = await bookmarkService.getChildren(bookmarkFolder.id);
    await this.syncLinks(projectId, collection.id, bookmarkLinks.filter(node => node.url));
  }

  /**
   * Sync links from bookmarks
   */
  private async syncLinks(projectId: string, collectionId: string, bookmarkLinks: chrome.bookmarks.BookmarkTreeNode[]): Promise<void> {
    const store = useAppStore.getState();
    const project = store.projects.find(p => p.id === projectId);
    const collection = project?.collections.find(c => c.id === collectionId);
    if (!collection) return;

    // Find links that exist in bookmarks but not in extension
    for (const bookmark of bookmarkLinks) {
      const existingLink = collection.links.find(l => l.bookmarkId === bookmark.id);
      
      if (!existingLink) {
        // Create new link from bookmark
        await this.createLinkFromBookmark(projectId, collectionId, bookmark);
      } else {
        // Sync existing link
        await this.syncLink(projectId, collectionId, existingLink, bookmark);
      }
    }

    // Find links that exist in extension but not in bookmarks (they were deleted)
    for (const link of collection.links) {
      if (link.bookmarkId) {
        const bookmarkExists = bookmarkLinks.find(b => b.id === link.bookmarkId);
        if (!bookmarkExists) {
          // Link's bookmark was deleted, remove link
          console.log(`Link "${link.title}" bookmark was deleted, removing link`);
          store.deleteLink(projectId, collectionId, link.id);
        }
      }
    }
  }

  /**
   * Create a new link from a bookmark
   */
  private async createLinkFromBookmark(projectId: string, collectionId: string, bookmark: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    console.log(`Creating link from bookmark: ${bookmark.title}`);
    
    const store = useAppStore.getState();
    
    const linkData = {
      title: bookmark.title || 'Untitled Link',
      url: bookmark.url || '',
      favIconUrl: `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url || '').hostname}`,
      tags: [],
      notes: 'Imported from bookmarks'
    };

    store.addLink(projectId, collectionId, linkData);

    // Find the newly created link and update its bookmark ID
    const updatedProject = useAppStore.getState().projects.find(p => p.id === projectId);
    const updatedCollection = updatedProject?.collections.find(c => c.id === collectionId);
    const newLink = updatedCollection?.links.find(l => l.url === linkData.url && !l.bookmarkId);
    
    if (newLink) {
      store.updateLink(projectId, collectionId, newLink.id, { bookmarkId: bookmark.id }, true);
    }
  }

  /**
   * Sync an existing link with its bookmark
   */
  private async syncLink(projectId: string, collectionId: string, link: Link, bookmark: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    const store = useAppStore.getState();
    const updates: Partial<Link> = {};

    // Check if title changed in bookmarks
    if (link.title !== bookmark.title) {
      console.log(`Link title changed in bookmarks: "${link.title}" -> "${bookmark.title}"`);
      updates.title = bookmark.title || link.title;
    }

    // Check if URL changed in bookmarks
    if (link.url !== bookmark.url) {
      console.log(`Link URL changed in bookmarks: "${link.url}" -> "${bookmark.url}"`);
      updates.url = bookmark.url || link.url;
      // Update favicon for new URL
      if (bookmark.url) {
        updates.favIconUrl = `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}`;
      }
    }

    if (Object.keys(updates).length > 0) {
      store.updateLink(projectId, collectionId, link.id, updates, true);
    }
  }

  /**
   * Handle bookmark created event
   */
  private async handleBookmarkCreated(id: string, bookmark: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
    if (this.syncInProgress) return;

    console.log('Bookmark created:', bookmark);
    
    // Check if this bookmark is within our managed folders
    if (bookmark.parentId && await this.isWithinManagedFolders(bookmark.parentId)) {
      // Trigger a partial sync for the affected area
      await this.performPartialSync(bookmark.parentId);
    }
  }

  /**
   * Handle bookmark removed event
   */
  private async handleBookmarkRemoved(id: string, removeInfo: { parentId: string; index: number; node: chrome.bookmarks.BookmarkTreeNode }): Promise<void> {
    if (this.syncInProgress) return;

    console.log('Bookmark removed:', id);
    
    // Check if this was within our managed folders
    if (await this.isWithinManagedFolders(removeInfo.parentId)) {
      // Trigger a partial sync for the affected area
      await this.performPartialSync(removeInfo.parentId);
    }
  }

  /**
   * Handle bookmark changed event
   */
  private async handleBookmarkChanged(id: string, changeInfo: { title?: string; url?: string }): Promise<void> {
    if (this.syncInProgress) return;

    console.log('Bookmark changed:', id, changeInfo);
    
    // Get the bookmark to check if it's in our managed folders
    const bookmark = await bookmarkService.getBookmarkNode(id);
    if (bookmark && bookmark.parentId && await this.isWithinManagedFolders(bookmark.parentId)) {
      // Trigger a partial sync for the affected area
      await this.performPartialSync(bookmark.parentId);
    }
  }

  /**
   * Handle bookmark moved event
   */
  private async handleBookmarkMoved(id: string, moveInfo: { parentId: string; index: number; oldParentId: string; oldIndex: number }): Promise<void> {
    if (this.syncInProgress) return;

    console.log('Bookmark moved:', id, moveInfo);
    
    // Check both old and new parent folders
    const affectedFolders = [moveInfo.oldParentId, moveInfo.parentId];
    
    for (const folderId of affectedFolders) {
      if (await this.isWithinManagedFolders(folderId)) {
        await this.performPartialSync(folderId);
      }
    }
  }

  /**
   * Check if a folder is within our managed bookmark folders
   */
  private async isWithinManagedFolders(folderId?: string): Promise<boolean> {
    if (!folderId) return false;

    const store = useAppStore.getState();
    const rootFolderId = store.tabManagerRootFolderId;
    
    if (!rootFolderId) return false;

    // Check if this folder is the root folder or a descendant
    let currentId = folderId;
    while (currentId) {
      if (currentId === rootFolderId) return true;
      
      const node = await bookmarkService.getBookmarkNode(currentId);
      if (!node || !node.parentId) break;
      
      currentId = node.parentId;
    }

    return false;
  }

  /**
   * Perform a partial sync for a specific folder
   */
  private async performPartialSync(folderId: string): Promise<void> {
    // For now, just trigger a full sync
    // In the future, this could be optimized to only sync the affected subtree
    setTimeout(() => this.performFullSync(), 1000); // Debounce multiple rapid changes
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (chrome.bookmarks) {
      chrome.bookmarks.onCreated.removeListener(this.handleBookmarkCreated.bind(this));
      chrome.bookmarks.onRemoved.removeListener(this.handleBookmarkRemoved.bind(this));
      chrome.bookmarks.onChanged.removeListener(this.handleBookmarkChanged.bind(this));
      chrome.bookmarks.onMoved.removeListener(this.handleBookmarkMoved.bind(this));
    }
    
    this.isInitialized = false;
    console.log('BookmarkSyncService destroyed');
  }
}

// Export singleton instance
export const bookmarkSyncService = new BookmarkSyncService();