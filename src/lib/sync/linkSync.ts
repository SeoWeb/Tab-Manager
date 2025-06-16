import { useAppStore } from '@/stores/appStore';
import type { Link } from '@/types';
import { getFaviconUrl } from '../utils';

export class LinkSync {
  /**
   * Sync links from bookmarks
   */
  async syncLinks(
    projectId: string,
    collectionId: string,
    bookmarkLinks: chrome.bookmarks.BookmarkTreeNode[]
  ): Promise<void> {
    const store = useAppStore.getState();
    const project = store.projects.find((p) => p.id === projectId);
    const collection = project?.collections.find((c) => c.id === collectionId);
    if (!collection) return;

    // Find links that exist in bookmarks but not in extension
    for (const bookmark of bookmarkLinks) {
      const existingLink = collection.links.find(
        (l) => l.bookmarkId === bookmark.id
      );

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
        const bookmarkExists = bookmarkLinks.find(
          (b) => b.id === link.bookmarkId
        );
        if (!bookmarkExists) {
          // Link's bookmark was deleted, remove link
          console.log(
            `Link "${link.title}" bookmark was deleted, removing link`
          );
          store.deleteLink(projectId, collectionId, link.id);
        }
      }
    }
  }

  /**
   * Create a new link from a bookmark
   */
  private async createLinkFromBookmark(
    projectId: string,
    collectionId: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    console.log(`Creating link from bookmark: ${bookmark.title}`);

    const store = useAppStore.getState();

    const linkData = {
      title: bookmark.title || 'Untitled Link',
      url: bookmark.url || '',
      favIconUrl: await getFaviconUrl(bookmark.url || ''),
      tags: [],
      notes: 'Imported from bookmarks',
    };

    store.addLink(projectId, collectionId, linkData, true); // Skip bookmark creation since we're syncing FROM bookmarks

    // Find the newly created link and update its bookmark ID
    const updatedProject = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId);
    const updatedCollection = updatedProject?.collections.find(
      (c) => c.id === collectionId
    );
    const newLink = updatedCollection?.links.find(
      (l) => l.url === linkData.url && !l.bookmarkId
    );

    if (newLink) {
      store.updateLink(
        projectId,
        collectionId,
        newLink.id,
        { bookmarkId: bookmark.id },
        true
      );
    }
  }

  /**
   * Sync an existing link with its bookmark
   */
  private async syncLink(
    projectId: string,
    collectionId: string,
    link: Link,
    bookmark: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    const store = useAppStore.getState();
    const updates: Partial<Link> = {};

    // Check if title changed in bookmarks
    if (link.title !== bookmark.title) {
      console.log(
        `Link title changed in bookmarks: "${link.title}" -> "${bookmark.title}"`
      );
      updates.title = bookmark.title || link.title;
    }

    // Check if URL changed in bookmarks
    if (link.url !== bookmark.url) {
      console.log(
        `Link URL changed in bookmarks: "${link.url}" -> "${bookmark.url}"`
      );
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
}
