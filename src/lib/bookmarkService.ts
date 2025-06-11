import { showErrorToast } from './toast';

// src/lib/bookmarkService.ts

/**
 * A wrapper around the chrome.bookmarks API for easier use and error handling.
 */
export const bookmarkService = {
  /**
   * Searches for bookmarks and folders.
   * @param query Either a string (searches title and URL) or an object {title, url}.
   *              To find a folder by title, provide {title: 'Folder Title'}.
   *              To find a bookmark by url, provide {url: 'http://example.com'}.
   */
  async searchBookmarks(
    query: string | { title?: string; url?: string }
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    try {
      const results = await chrome.bookmarks.search(query);
      return results;
    } catch (error) {
      console.error('Error searching bookmarks:', error);
      showErrorToast('Error searching bookmarks.');
      // It's possible for search to be rejected if the query is invalid,
      // though the API docs don't explicitly state rejection conditions for search.
      // More often, it resolves to an empty array if nothing is found or query is empty.
      return []; // Return empty array on error or if search fails
    }
  },

  /**
   * Creates a new bookmark folder.
   * @param parentId The ID of the parent folder. If undefined, creates in "Other Bookmarks" (usually).
   *                 For top-level on bookmarks bar, it's usually '1'.
   * @param title The title of the new folder.
   */
  async createBookmarkFolder(
    title: string,
    parentId?: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    try {
      if (!title) {
        throw new Error('Folder title cannot be empty.');
      }
      const newFolder = await chrome.bookmarks.create({
        parentId,
        title,
      });
      return newFolder;
    } catch (error) {
      console.error(`Error creating bookmark folder "${title}":`, error);
      if (error instanceof Error) {
        showErrorToast(`Error creating bookmark folder: ${error.message}`);
      } else {
        showErrorToast(
          'An unknown error occurred while creating the bookmark folder.'
        );
      }
      throw error; // Re-throw to allow caller to handle
    }
  },

  /**
   * Creates a new bookmark.
   * @param parentId The ID of the parent folder.
   * @param title The title of the bookmark.
   * @param url The URL of the bookmark.
   */
  async createBookmark(
    parentId: string,
    title: string,
    url: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    try {
      if (!parentId) {
        throw new Error('Parent ID is required to create a bookmark.');
      }
      if (!url || !title) {
        throw new Error('Title and URL are required to create a bookmark.');
      }
      const newBookmark = await chrome.bookmarks.create({
        parentId,
        title,
        url,
      });
      return newBookmark;
    } catch (error) {
      console.error(`Error creating bookmark "${title}" (${url}):`, error);
      if (error instanceof Error) {
        showErrorToast(`Error creating bookmark: ${error.message}`);
      } else {
        showErrorToast(
          'An unknown error occurred while creating the bookmark.'
        );
      }
      throw error;
    }
  },

  /**
   * Updates an existing bookmark or folder.
   * @param id The ID of the bookmark/folder to update.
   * @param changes An object with { title?: string, url?: string }.
   */
  async updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    try {
      if (!id) {
        throw new Error('Bookmark ID is required for update.');
      }
      if (
        (changes.title !== undefined && changes.title.trim() === '') ||
        (changes.url !== undefined && changes.url.trim() === '')
      ) {
        // Note: API might allow empty title for folders, but disallow for bookmarks.
        // For simplicity, we can enforce non-empty title if provided.
        // URL must not be empty if provided for a bookmark.
      }
      const updatedNode = await chrome.bookmarks.update(id, changes);
      return updatedNode;
    } catch (error) {
      console.error(`Error updating bookmark ID "${id}":`, error);
      if (error instanceof Error) {
        showErrorToast(`Error updating bookmark: ${error.message}`);
      } else {
        showErrorToast(
          'An unknown error occurred while updating the bookmark.'
        );
      }
      throw error;
    }
  },

  /**
   * Deletes a bookmark or an empty bookmark folder.
   * @param id The ID of the bookmark/folder to delete.
   */
  async deleteBookmark(id: string): Promise<void> {
    try {
      if (!id) {
        throw new Error('Bookmark ID is required for deletion.');
      }
      await chrome.bookmarks.remove(id);
    } catch (error) {
      // API throws error if folder is not empty. Use deleteBookmarkTree for that.
      console.error(`Error deleting bookmark/empty folder ID "${id}":`, error);
      if (error instanceof Error) {
        showErrorToast(`Error deleting bookmark: ${error.message}`);
      } else {
        showErrorToast(
          'An unknown error occurred while deleting the bookmark.'
        );
      }
      throw error;
    }
  },

  /**
   * Deletes a bookmark folder and all its contents (recursively).
   * @param id The ID of the folder to delete.
   */
  async deleteBookmarkTree(id: string): Promise<void> {
    try {
      if (!id) {
        throw new Error(
          'Bookmark folder ID is required for recursive deletion.'
        );
      }
      await chrome.bookmarks.removeTree(id);
    } catch (error) {
      console.error(`Error deleting bookmark tree ID "${id}":`, error);
      if (error instanceof Error) {
        showErrorToast(`Error deleting bookmark folder: ${error.message}`);
      } else {
        showErrorToast(
          'An unknown error occurred while deleting the bookmark folder.'
        );
      }
      throw error;
    }
  },

  /**
   * Retrieves a bookmark tree node by its ID.
   * @param id The ID of the bookmark node to retrieve.
   */
  async getBookmarkNode(
    id: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    try {
      if (!id) {
        // console.warn('getBookmarkNode: ID is required.'); // Or throw error
        return null;
      }
      const results = await chrome.bookmarks.get(id);
      return results && results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error(`Error retrieving bookmark node ID "${id}":`, error);
      showErrorToast('Error retrieving bookmark.');
      // This error occurs if the ID doesn't exist.
      return null;
    }
  },

  /**
   * Retrieves the children of a bookmark folder.
   * @param folderId The ID of the folder.
   */
  async getChildren(
    folderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    try {
      if (!folderId) {
        // console.warn('getChildren: folderId is required.'); // Or throw error
        return [];
      }
      const children = await chrome.bookmarks.getChildren(folderId);
      return children;
    } catch (error) {
      console.error(
        `Error retrieving children for folder ID "${folderId}":`,
        error
      );
      showErrorToast('Error retrieving bookmark folder contents.');
      // This error can occur if folderId does not exist or is not a folder.
      return [];
    }
  },

  /**
   * Moves a bookmark to a new location in the bookmark tree.
   * @param id The ID of the bookmark/folder to move.
   * @param destination An object with { parentId?: string, index?: number }.
   */
  async moveBookmark(
    id: string,
    destination: { parentId?: string; index?: number }
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    try {
      if (!id) {
        throw new Error('Bookmark ID is required for move.');
      }
      const movedNode = await chrome.bookmarks.move(id, destination);
      return movedNode;
    } catch (error) {
      console.error(`Error moving bookmark ID "${id}":`, error);
      if (error instanceof Error) {
        showErrorToast(`Error moving bookmark: ${error.message}`);
      } else {
        showErrorToast('An unknown error occurred while moving the bookmark.');
      }
      throw error;
    }
  },
};

// Ensure chrome types are available. If not, this might indicate an issue with @types/chrome installation or tsconfig.
// Example of checking:
// const exampleBookmark: chrome.bookmarks.BookmarkTreeNode = { id: '1', title: 'test' };
// console.log(exampleBookmark); // This line is for type checking during development, remove for production.
