import { bookmarkService } from '../bookmarkService';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import { CollectionSync } from './collectionSync';

export class ProjectSync {
  private collectionSync = new CollectionSync();

  /**
   * Sync projects from bookmark folders
   */
  async syncProjects(
    bookmarkProjectFolders: chrome.bookmarks.BookmarkTreeNode[]
  ): Promise<void> {
    const store = useAppStore.getState();
    const currentProjects = store.projects;

    // Find projects that exist in bookmarks but not in extension
    const syncPromises = bookmarkProjectFolders.map((bookmarkFolder) => {
      const existingProject = currentProjects.find(
        (p) => p.bookmarkFolderId === bookmarkFolder.id
      );

      if (!existingProject) {
        // Create new project from bookmark folder
        return this.createProjectFromBookmark(bookmarkFolder);
      } else {
        // Sync existing project
        return this.syncProject(existingProject, bookmarkFolder);
      }
    });

    await Promise.all(syncPromises);

    // Find projects that exist in extension but not in bookmarks (they were deleted)
    for (const project of currentProjects) {
      if (project.bookmarkFolderId) {
        const bookmarkExists = bookmarkProjectFolders.find(
          (bf) => bf.id === project.bookmarkFolderId
        );
        if (!bookmarkExists) {
          // Project's bookmark folder was deleted, remove project
          store.deleteProject(project.id);
        }
      }
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

    store.addProject(projectData, { skipBookmarkCreation: true }); // Skip bookmark creation since we're syncing FROM bookmarks

    // Find the newly created project and update its bookmark folder ID
    const projects = useAppStore.getState().projects;
    const newProject = projects.find(
      (p) => p.name === projectData.name && !p.bookmarkFolderId
    );

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
