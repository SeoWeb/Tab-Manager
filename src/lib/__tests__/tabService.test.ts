/**
 * Test file for Chrome Tabs API Service
 * Note: These tests will only work in a Chrome extension context
 */

import {
  getAllWindows,
  createTab,
  closeTab,
  findTabByUrl,
  checkTabsPermission,
} from '../tabService';

describe('Chrome Tabs Service', () => {
  // Mock chrome API for testing
  const mockChrome = {
    windows: {
      getAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    tabs: {
      query: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
      move: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      onCreated: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      onRemoved: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      onUpdated: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    },
    permissions: {
      contains: jest.fn(),
    },
  };

  beforeEach(() => {
    // Mock the global chrome object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).chrome = mockChrome;
    jest.clearAllMocks();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).chrome;
  });

  describe('getAllWindows', () => {
    it('should return formatted window data', async () => {
      const mockWindows = [
        {
          id: 1,
          focused: true,
          type: 'normal',
          tabs: [
            {
              id: 1,
              title: 'Test Tab',
              url: 'https://example.com',
              favIconUrl: 'https://example.com/favicon.ico',
              windowId: 1,
            },
          ],
        },
      ];

      mockChrome.windows.getAll.mockResolvedValue(mockWindows);

      const result = await getAllWindows();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        name: 'Window 1',
        isFocused: true,
        type: 'normal',
        tabs: [
          {
            id: 1,
            title: 'Test Tab',
            url: 'https://example.com',
            favIconUrl: 'https://example.com/favicon.ico',
            windowId: 1,
          },
        ],
      });
    });

    it('should handle API errors gracefully', async () => {
      mockChrome.windows.getAll.mockRejectedValue(new Error('API Error'));

      const result = await getAllWindows();

      expect(result).toEqual([]);
    });
  });

  describe('createTab', () => {
    it('should create a new tab', async () => {
      const mockTab = {
        id: 2,
        title: 'New Tab',
        url: 'https://newsite.com',
        windowId: 1,
      };

      mockChrome.tabs.create.mockResolvedValue(mockTab);

      const result = await createTab('https://newsite.com', 1);

      expect(mockChrome.tabs.create).toHaveBeenCalledWith({
        url: 'https://newsite.com',
        windowId: 1,
        active: false,
      });

      expect(result).toEqual({
        id: 2,
        title: 'New Tab',
        url: 'https://newsite.com',
        favIconUrl: undefined,
        windowId: 1,
      });
    });
  });

  describe('closeTab', () => {
    it('should close a tab successfully', async () => {
      mockChrome.tabs.remove.mockResolvedValue(undefined);

      const result = await closeTab(1);

      expect(mockChrome.tabs.remove).toHaveBeenCalledWith(1);
      expect(result).toBe(true);
    });

    it('should handle close errors', async () => {
      mockChrome.tabs.remove.mockRejectedValue(new Error('Close failed'));

      const result = await closeTab(1);

      expect(result).toBe(false);
    });
  });

  describe('findTabByUrl', () => {
    it('should find existing tab by URL', async () => {
      const mockTabs = [
        {
          id: 1,
          title: 'Existing Tab',
          url: 'https://example.com',
          windowId: 1,
        },
      ];

      mockChrome.tabs.query.mockResolvedValue(mockTabs);

      const result = await findTabByUrl('https://example.com');

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({
        url: 'https://example.com',
      });

      expect(result).toEqual({
        id: 1,
        title: 'Existing Tab',
        url: 'https://example.com',
        favIconUrl: undefined,
        windowId: 1,
      });
    });

    it('should return null if no tab found', async () => {
      mockChrome.tabs.query.mockResolvedValue([]);

      const result = await findTabByUrl('https://notfound.com');

      expect(result).toBeNull();
    });
  });

  describe('checkTabsPermission', () => {
    it('should check tabs permission', async () => {
      mockChrome.permissions.contains.mockResolvedValue(true);

      const result = await checkTabsPermission();

      expect(mockChrome.permissions.contains).toHaveBeenCalledWith({
        permissions: ['tabs'],
      });

      expect(result).toBe(true);
    });
  });
});
