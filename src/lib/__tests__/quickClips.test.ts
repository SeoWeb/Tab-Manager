// src/lib/__tests__/quickClips.test.ts

jest.mock('nanoid', () => ({ nanoid: () => 'fixed-id' }));

import {
  getQuickClips,
  addQuickClip,
  removeQuickClip,
  subscribeQuickClips,
  resolveClipFromContext,
  type QuickClip,
} from '../quickClips';
import { onQuickClipClicked } from '../../background/quickClip';

// In-memory chrome.storage.local mock.
function createChromeMock() {
  const store: Record<string, unknown> = {};
  const listeners: Array<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => void
  > = [];

  const chromeMock = {
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (result: Record<string, unknown>) => void
        ) => {
          const result: Record<string, unknown> = {};
          const keyArr = Array.isArray(keys) ? keys : [keys];
          keyArr.forEach((k) => {
            if (k in store) result[k] = store[k];
          });
          cb(result);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: store[k], newValue: obj[k] };
            store[k] = obj[k];
          }
          listeners.forEach((l) => l(changes, 'local'));
          cb?.();
        },
      },
      onChanged: {
        addListener: (l: (typeof listeners)[number]) => listeners.push(l),
        removeListener: (l: (typeof listeners)[number]) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
    runtime: { lastError: null as unknown },
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
    },
  };

  return { chromeMock, store };
}

let chromeBundle: ReturnType<typeof createChromeMock>;

beforeEach(() => {
  chromeBundle = createChromeMock();
  (globalThis as unknown as { chrome: unknown }).chrome =
    chromeBundle.chromeMock;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('quickClips storage', () => {
  it('returns [] when nothing is stored', async () => {
    expect(await getQuickClips()).toEqual([]);
  });

  it('adds and reads a clip (newest first)', async () => {
    const older: QuickClip = {
      id: 'a',
      title: 'Older',
      url: 'https://older.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const newer: QuickClip = {
      id: 'b',
      title: 'Newer',
      url: 'https://newer.com',
      createdAt: '2024-02-01T00:00:00.000Z',
    };
    await addQuickClip(older);
    await addQuickClip(newer);
    const clips = await getQuickClips();
    expect(clips.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('dedupes by normalized URL', async () => {
    await addQuickClip({
      id: '1',
      title: 'A',
      url: 'https://example.com/page',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await addQuickClip({
      id: '2',
      title: 'B',
      url: 'https://Example.com/page',
      createdAt: '2024-01-02T00:00:00.000Z',
    });
    const clips = await getQuickClips();
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe('1');
  });

  it('removes a clip by id', async () => {
    await addQuickClip({
      id: 'x',
      title: 'X',
      url: 'https://x.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await removeQuickClip('x');
    expect(await getQuickClips()).toEqual([]);
  });

  it('notifies subscribers on change', async () => {
    const received: QuickClip[][] = [];
    const unsub = subscribeQuickClips((clips) => received.push(clips));
    await addQuickClip({
      id: 's',
      title: 'S',
      url: 'https://s.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await Promise.resolve();
    expect(received.some((list) => list[0]?.id === 's')).toBe(true);
    unsub();
  });
});

describe('resolveClipFromContext', () => {
  it('prefers linkUrl for link right-clicks', () => {
    const r = resolveClipFromContext(
      { linkUrl: 'https://link.com', pageUrl: 'https://page.com' },
      { url: 'https://page.com', title: 'Page' }
    );
    expect(r?.url).toBe('https://link.com');
  });

  it('falls back to pageUrl', () => {
    const r = resolveClipFromContext(
      { pageUrl: 'https://page.com' },
      { url: 'https://page.com', title: 'Page' }
    );
    expect(r?.url).toBe('https://page.com');
    expect(r?.title).toBe('Page');
  });

  it('uses selectionText as title when present', () => {
    const r = resolveClipFromContext(
      { pageUrl: 'https://page.com', selectionText: 'My Selection' },
      { url: 'https://page.com', title: 'Page' }
    );
    expect(r?.title).toBe('My Selection');
  });

  it('returns null for chrome:// URLs', () => {
    expect(
      resolveClipFromContext(
        { pageUrl: 'chrome://extensions' },
        { url: 'chrome://extensions', title: 'Extensions' }
      )
    ).toBeNull();
  });

  it('returns null for about: and data: URLs', () => {
    expect(resolveClipFromContext({ pageUrl: 'about:blank' })).toBeNull();
    expect(
      resolveClipFromContext({ pageUrl: 'data:text/html,<x>' })
    ).toBeNull();
  });

  it('returns null when no url is available', () => {
    expect(resolveClipFromContext({}, {})).toBeNull();
  });
});

describe('onQuickClipClicked (service worker handler)', () => {
  it('saves a page clip to storage', async () => {
    await onQuickClipClicked(
      { menuItemId: 'save-to-tabspace', pageUrl: 'https://saved.com' } as never,
      { url: 'https://saved.com', title: 'Saved', favIconUrl: '' } as never
    );
    const clips = await getQuickClips();
    expect(clips).toHaveLength(1);
    expect(clips[0].url).toBe('https://saved.com');
    expect(clips[0].title).toBe('Saved');
  });

  it('does not save chrome:// pages', async () => {
    await onQuickClipClicked(
      {
        menuItemId: 'save-to-tabspace',
        pageUrl: 'chrome://settings',
      } as never,
      { url: 'chrome://settings', title: 'Settings' } as never
    );
    expect(await getQuickClips()).toEqual([]);
  });
});
