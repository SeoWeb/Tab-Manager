'use client';

import { Bookmark } from 'lucide-react';

/**
 * Web shadow of the Bookmarks panel.
 *
 * The extension version reads from `chrome.bookmarks`; there is no equivalent
 * on the web, so this renders a static "not available" notice instead of the
 * live bookmark tree. Same default export name as the extension component so the
 * right-panel tab that mounts it resolves unchanged.
 */
export default function BookmarksPanelContent() {
  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground flex items-center'>
        <Bookmark className='mr-2 h-5 w-5 text-primary' />
        Chrome Bookmarks
      </h3>
      <div className='rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground'>
        Not available in web version.
        <br />
        Chrome bookmarks require the browser extension.
      </div>
    </div>
  );
}
