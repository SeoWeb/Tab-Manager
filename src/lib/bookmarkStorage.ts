// src/lib/bookmarkStorage.ts

import { bookmarkService } from './bookmarkService';
import { bookmarkSyncService } from './bookmarkSyncService';
import type {} from '@/types';

const ROOT_FOLDER_NAME = 'TabManager Root';

/**
 * Manages the application's data storage within Chrome bookmarks.
 */
export const bookmarkStorage = {
  /**
   * Initializes the bookmark storage, ensuring the root folder exists.
   * @returns The ID of the root folder.
   */
  async initialize(): Promise<string> {
    let rootFolder = await this.findRootFolder();
    if (!rootFolder) {
      console.log(`Root folder not found, creating...`);
      // Create in "Other Bookmarks" (ID: '2')
      rootFolder = await bookmarkService.createBookmarkFolder(
        ROOT_FOLDER_NAME,
        '2'
      );
    }

    // Defer sync operations to avoid blocking initialization
    setTimeout(async () => {
      try {
        // Initialize bookmark sync service
        await bookmarkSyncService.initialize();
        // Perform initial sync
        await bookmarkSyncService.performFullSync();
      } catch (error) {
        console.error('Error during bookmark sync initialization:', error);
      }
    }, 500);

    return rootFolder.id;
  },

  /**
   * Finds the root folder for the application's bookmarks.
   * @returns The root folder's bookmark tree node, or null if not found.
   */
  async findRootFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const results = await bookmarkService.searchBookmarks({
      title: ROOT_FOLDER_NAME,
    });
    // Filter for folders specifically, as search can return bookmarks with similar titles
    const folder = results.find((node) => node.url === undefined);
    return folder || null;
  },

  /**
   * Creates a project folder within the root folder.
   * @param projectName The name of the project
   * @param rootFolderId The ID of the root folder
   * @returns The created project folder
   */
  async createProject(
    projectName: string,
    rootFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return await bookmarkService.createBookmarkFolder(
      projectName,
      rootFolderId
    );
  },

  /**
   * Updates a project folder's name.
   * @param projectFolderId The ID of the project folder
   * @param newName The new name for the project
   */
  async updateProject(projectFolderId: string, newName: string): Promise<void> {
    await bookmarkService.updateBookmark(projectFolderId, { title: newName });
  },

  /**
   * Deletes a project folder and all its contents.
   * @param projectFolderId The ID of the project folder
   */
  async deleteProject(projectFolderId: string): Promise<void> {
    await bookmarkService.deleteBookmarkTree(projectFolderId);
  },

  /**
   * Creates a collection folder within a project folder.
   * @param collectionName The name of the collection
   * @param projectFolderId The ID of the project folder
   * @returns The created collection folder
   */
  async createCollection(
    collectionName: string,
    projectFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return await bookmarkService.createBookmarkFolder(
      collectionName,
      projectFolderId
    );
  },

  /**
   * Updates a collection folder's name.
   * @param collectionFolderId The ID of the collection folder
   * @param newName The new name for the collection
   */
  async updateCollection(
    collectionFolderId: string,
    newName: string
  ): Promise<void> {
    await bookmarkService.updateBookmark(collectionFolderId, {
      title: newName,
    });
  },

  /**
   * Deletes a collection folder and all its contents.
   * @param collectionFolderId The ID of the collection folder
   */
  async deleteCollection(collectionFolderId: string): Promise<void> {
    await bookmarkService.deleteBookmarkTree(collectionFolderId);
  },

  /**
   * Creates a link bookmark within a collection folder.
   * @param linkTitle The title of the link
   * @param linkUrl The URL of the link
   * @param collectionFolderId The ID of the collection folder
   * @returns The created link bookmark
   */
  async createLink(
    linkTitle: string,
    linkUrl: string,
    collectionFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return await bookmarkService.createBookmark(
      collectionFolderId,
      linkTitle,
      linkUrl
    );
  },

  /**
   * Updates a link bookmark's title and/or URL.
   * @param linkId The ID of the link bookmark
   * @param updates The updates to apply (title and/or url)
   */
  async updateLink(
    linkId: string,
    updates: { title?: string; url?: string }
  ): Promise<void> {
    await bookmarkService.updateBookmark(linkId, updates);
  },

  /**
   * Deletes a link bookmark.
   * @param linkId The ID of the link bookmark
   */
  async deleteLink(linkId: string): Promise<void> {
    await bookmarkService.deleteBookmark(linkId);
  },

  /**
   * Gets all projects from the root folder.
   * @param rootFolderId The ID of the root folder
   * @returns Array of project folders
   */
  async getProjects(
    rootFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const children = await bookmarkService.getChildren(rootFolderId);
    return children.filter((node) => !node.url); // Only folders
  },

  /**
   * Gets all collections from a project folder.
   * @param projectFolderId The ID of the project folder
   * @returns Array of collection folders
   */
  async getCollections(
    projectFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const children = await bookmarkService.getChildren(projectFolderId);
    return children.filter((node) => !node.url); // Only folders
  },

  /**
   * Gets all links from a collection folder.
   * @param collectionFolderId The ID of the collection folder
   * @returns Array of link bookmarks
   */
  async getLinks(
    collectionFolderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const children = await bookmarkService.getChildren(collectionFolderId);
    return children.filter((node) => node.url); // Only bookmarks with URLs
  },

  /**
   * Moves a bookmark to a new location.
   * @param linkId The ID of the link bookmark to move.
   * @param destination The destination details { parentId, index }.
   */
  async moveBookmark(
    linkId: string,
    destination: { parentId?: string; index?: number }
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return await bookmarkService.moveBookmark(linkId, destination);
  },
};
