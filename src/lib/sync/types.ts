export interface BookmarkSyncService {
  /** True while a bookmark → extension sync is running. */
  syncInProgress: boolean;
  /**
   * True while an extension-initiated bookmark write is in flight (managed
   * with try/finally in `bookmarkStorage.withSuppressedSyncEcho`). Bookmark
   * events arriving during this window are echoes of our own write and are
   * dropped instead of triggering another sync.
   */
  suppressEchoes: boolean;
  isWithinManagedFolders(folderId?: string): Promise<boolean>;
  performPartialSync(folderId: string): Promise<void>;
}
