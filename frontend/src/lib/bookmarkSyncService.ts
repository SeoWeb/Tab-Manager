/**
 * Web stub for the bookmark→extension bidirectional sync service.
 *
 * Same exports (`BookmarkSyncService` class + `bookmarkSyncService` singleton)
 * and method/property shapes as the extension's
 * `src/lib/bookmarkSyncService.ts`. With no chrome.bookmarks events on the web,
 * every method is a no-op and `syncInProgress` is inert.
 *
 * Only the (shadowed) `bookmarkStorage` imports this in the extension; the web
 * bookmarkStorage stub does not, so this is effectively dead code — it exists
 * to keep the module resolvable for any transitive importer.
 */
export class BookmarkSyncService {
  public syncInProgress = false;

  async initialize(): Promise<void> {
    return;
  }

  async performFullSync(): Promise<void> {
    return;
  }

  async isWithinManagedFolders(_folderId?: string): Promise<boolean> {
    return false;
  }

  async performPartialSync(_folderId: string): Promise<void> {
    return;
  }

  destroy(): void {
    return;
  }
}

// Export singleton instance
export const bookmarkSyncService = new BookmarkSyncService();
