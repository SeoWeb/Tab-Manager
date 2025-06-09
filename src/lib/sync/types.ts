export interface BookmarkSyncService {
  syncInProgress: boolean;
  isWithinManagedFolders(folderId?: string): Promise<boolean>;
  performPartialSync(folderId: string): Promise<void>;
}
