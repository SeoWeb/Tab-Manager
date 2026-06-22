/**
 * Web stub for the Chrome-bookmarks-backed project/collection/link storage.
 *
 * Same export name (`bookmarkStorage`) and method shapes as the extension's
 * `src/lib/bookmarkStorage.ts` so the un-shadowed store actions resolve
 * unchanged. There are no Chrome bookmarks on the web, so every method is a
 * no-op.
 *
 * Unreachable at runtime: the actions only call these when a `bookmarkFolderId`
 * exists, and the web AppClient never runs `initialize()`, so
 * `tabManagerRootFolderId` stays `null` and no project/collection/link ever
 * receives a `bookmarkFolderId`. `initialize()` deliberately returns an empty
 * string (falsy) so that, even if invoked, it cannot arm the bookmark path.
 */
type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export const bookmarkStorage = {
  async initialize(): Promise<string> {
    // Falsy on purpose: keeps the root-folder guards inert.
    return '';
  },

  async findRootFolder(): Promise<BookmarkNode | null> {
    return null;
  },

  async createProject(
    projectName: string,
    _rootFolderId: string
  ): Promise<BookmarkNode> {
    return { id: 'web-stub', title: projectName } as BookmarkNode;
  },

  async updateProject(
    _projectFolderId: string,
    _newName: string
  ): Promise<void> {
    return;
  },

  async deleteProject(_projectFolderId: string): Promise<void> {
    return;
  },

  async createCollection(
    collectionName: string,
    _projectFolderId: string
  ): Promise<BookmarkNode> {
    return { id: 'web-stub', title: collectionName } as BookmarkNode;
  },

  async updateCollection(
    _collectionFolderId: string,
    _newName: string
  ): Promise<void> {
    return;
  },

  async deleteCollection(_collectionFolderId: string): Promise<void> {
    return;
  },

  async createLink(
    linkTitle: string,
    linkUrl: string,
    _collectionFolderId: string
  ): Promise<BookmarkNode> {
    return { id: 'web-stub', title: linkTitle, url: linkUrl } as BookmarkNode;
  },

  async updateLink(
    _linkId: string,
    _updates: { title?: string; url?: string }
  ): Promise<void> {
    return;
  },

  async deleteLink(_linkId: string): Promise<void> {
    return;
  },

  async getProjects(_rootFolderId: string): Promise<BookmarkNode[]> {
    return [];
  },

  async getCollections(_projectFolderId: string): Promise<BookmarkNode[]> {
    return [];
  },

  async getLinks(_collectionFolderId: string): Promise<BookmarkNode[]> {
    return [];
  },

  async moveBookmark(
    _linkId: string,
    _destination: { parentId?: string; index?: number }
  ): Promise<BookmarkNode> {
    return { id: 'web-stub' } as BookmarkNode;
  },
};
