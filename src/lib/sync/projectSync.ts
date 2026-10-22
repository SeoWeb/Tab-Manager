import { bookmarkService } from '@/lib/bookmarkService';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import { CollectionSync } from './collectionSync';

export class ProjectSync {
  private collectionSync = new CollectionSync();

  /**
   * Sync projects from bookmark folders.
   *
   * Matching rules (spec: entity matching uses bookmark folder IDs only):
   * - A folder is tied to the project that references it by `bookmarkFolderId`.
   * - A folder whose id matches a project's `mirrorRemovedFolderId` restores
   *   that project's mapping (folder re-appeared with the same id).
   * - A folder referenced by no entity is adopted by CREATION (a new project
   *   referencing it by id) — never by matching display names.
   */
  async syncProjects(
    bookmarkProjectFolders: chrome.bookmarks.BookmarkTreeNode[]
  ): Promise<void> {
    const store = useAppStore.getState();
    const currentProjects = store.projects;

    // Find projects that exist in bookmarks but not in extension
    const syncPromises = bookmarkProjectFolders.map(async (bookmarkFolder) => {
      const existingProject = currentProjects.find(
        (p) => p.bookmarkFolderId === bookmarkFolder.id
      );

      if (existingProject) {
        // Sync existing project
        await this.syncProject(existingProject, bookmarkFolder);
        return;
      }

      // A mirrored folder that previously vanished can restore its mapping
      // when it re-appears with the same stored id.
      const removedProject = currentProjects.find(
        (p) => p.mirrorRemoved && p.mirrorRemovedFolderId === bookmarkFolder.id
      );
      if (removedProject) {
        store.updateProject(
          removedProject.id,
          {
            bookmarkFolderId: bookmarkFolder.id,
            mirrorRemoved: false,
            mirrorRemovedFolderId: null,
          },
          true
        );
        await this.syncProject(
          { ...removedProject, bookmarkFolderId: bookmarkFolder.id },
          bookmarkFolder
        );
        return;
      }

      // Create new project from (currently unreferenced) bookmark folder,
      // linking it by id — never by name.
      await this.createProjectFromBookmark(bookmarkFolder);
    });

    await Promise.all(syncPromises);

    // Missing mirrored folders: mark the project "mirror removed" but NEVER
    // delete local data. Read FRESH state after the awaits above — the
    // pre-await snapshot is stale (create/sync steps mutate the store).
    const freshProjects = useAppStore.getState().projects;
    const folderIds = new Set(bookmarkProjectFolders.map((bf) => bf.id));

    for (const project of freshProjects) {
      const mirrorId =
        project.bookmarkFolderId ?? project.mirrorRemovedFolderId ?? null;
      if (!mirrorId || folderIds.has(mirrorId)) continue;
      if (project.mirrorRemoved) continue; // already marked

      console.warn(
        `[ProjectSync] Bookmark folder "${mirrorId}" for project "${project.name}" is gone; marking mirror removed (local data kept).`
      );
      store.updateProject(
        project.id,
        {
          bookmarkFolderId: null,
          mirrorRemoved: true,
          mirrorRemovedFolderId: mirrorId,
        },
        true
      );
    }
  }

  /**
   * Create a new project from a bookmark folder
   */
  private async createProjectFromBookmark(
    bookmarkFolder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    const store = useAppStore.getState();

    // Create project with basic info
    const projectData = {
      name: bookmarkFolder.title || 'Untitled Project',
      description: `Imported from bookmarks`,
      color: '#4285F4', // Default color
      icon: bookmarkFolder.title
        ? bookmarkFolder.title.charAt(0).toUpperCase()
        : '📁',
    };

    // Capture the existing project ids BEFORE the insert so the newly added
    // project can be identified by id. (Previously this matched by display
    // name, which mislinked projects when duplicate folder titles existed.)
    const existingIds = new Set(store.projects.map((p) => p.id));

    store.addProject(projectData, { skipBookmarkCreation: true }); // Skip bookmark creation since we're syncing FROM bookmarks

    // The newly created project is the one whose id we have not seen before.
    const projects = useAppStore.getState().projects;
    const newProject = projects.find((p) => !existingIds.has(p.id));

    if (newProject) {
      store.updateProject(
        newProject.id,
        { bookmarkFolderId: bookmarkFolder.id },
        true
      );

      // Sync collections for this project
      const collectionFolders = await bookmarkService.getChildren(
        bookmarkFolder.id
      );
      await this.collectionSync.syncCollections(
        newProject.id,
        collectionFolders.filter((node) => !node.url)
      );
    } else {
      // The insert did not yield a new entity (should not happen); report the
      // folder as unreferenced instead of guessing by name.
      console.warn(
        `[ProjectSync] Could not locate the project created for bookmark folder "${bookmarkFolder.id}"; folder left unreferenced.`
      );
    }
  }

  /**
   * Sync an existing project with its bookmark folder
   */
  private async syncProject(
    project: Project,
    bookmarkFolder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    const store = useAppStore.getState();

    // Check if project name changed in bookmarks
    if (project.name !== bookmarkFolder.title) {
      store.updateProject(
        project.id,
        { name: bookmarkFolder.title || project.name },
        true
      );
    }

    // Sync collections
    const collectionFolders = await bookmarkService.getChildren(
      bookmarkFolder.id
    );
    await this.collectionSync.syncCollections(
      project.id,
      collectionFolders.filter((node) => !node.url)
    );
  }
}
