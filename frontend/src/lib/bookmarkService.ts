/**
 * Web stub for the chrome.bookmarks wrapper.
 *
 * Same export name (`bookmarkService`) and method shapes as the extension's
 * `src/lib/bookmarkService.ts` so importers (notably the un-shadowed
 * `lib/sync/*` and the store actions) resolve unchanged. There is no
 * chrome.bookmarks API on the web, so every method is a no-op that resolves to
 * an empty/dummy value rather than throwing.
 *
 * In practice these are unreachable in the web build: every store-action call
 * site is guarded by a truthiness check on `bookmarkFolderId` /
 * `tabManagerRootFolderId`, and the web AppClient never calls
 * `bookmarkStorage.initialize()`, so that root id stays `null` and the whole
 * bookmark integration is silently skipped. The methods below are a safety net.
 */

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

const dummy = (overrides: Partial<BookmarkNode> = {}): BookmarkNode =>
  ({
    id: 'web-stub',
    title: '',
    ...overrides,
  }) as BookmarkNode;

export const bookmarkService = {
  async searchBookmarks(
    _query: string | { title?: string; url?: string }
  ): Promise<BookmarkNode[]> {
    return [];
  },

  async createBookmarkFolder(
    title: string,
    _parentId?: string
  ): Promise<BookmarkNode> {
    return dummy({ title });
  },

  async createBookmark(
    parentId: string,
    title: string,
    url: string
  ): Promise<BookmarkNode> {
    return dummy({ parentId, title, url });
  },

  async updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    return dummy({ id, ...changes });
  },

  async deleteBookmark(_id: string): Promise<void> {
    return;
  },

  async deleteBookmarkTree(_id: string): Promise<void> {
    return;
  },

  async getBookmarkNode(_id: string): Promise<BookmarkNode | null> {
    return null;
  },

  async getChildren(_folderId: string): Promise<BookmarkNode[]> {
    return [];
  },

  async moveBookmark(
    id: string,
    _destination: { parentId?: string; index?: number }
  ): Promise<BookmarkNode> {
    return dummy({ id });
  },
};
