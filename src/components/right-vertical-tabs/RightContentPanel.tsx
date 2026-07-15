'use client';

import { lazy, Suspense } from 'react';
import { useActiveVerticalTabId } from '@/hooks/useAppStoreWithDefaults';
import { Skeleton } from '@/components/ui/skeleton';

const LazyChromeOpenTabsPanel = lazy(
  () => import('./panels/ChromeOpenTabsPanel')
);
const LazyBookmarksPanelContent = lazy(
  () => import('@/components/right-panel/panels/BookmarksPanelContent')
);
const LazyTabSessionsPanel = lazy(() =>
  import('./panels/TabSessionsPanel').then((m) => ({
    default: m.TabSessionsPanel,
  }))
);
const LazyQuickClipsPanel = lazy(() => import('./panels/QuickClipsPanel'));

export default function RightContentPanel() {
  const activeVerticalTabId = useActiveVerticalTabId();

  const renderPanelContent = () => {
    switch (activeVerticalTabId) {
      case 'openTabs':
        return (
          <Suspense fallback={<Skeleton className='h-full w-full' />}>
            <LazyChromeOpenTabsPanel />
          </Suspense>
        );
      case 'bookmarks':
        return (
          <Suspense fallback={<Skeleton className='h-full w-full' />}>
            <LazyBookmarksPanelContent />
          </Suspense>
        );
      case 'sessions':
        return (
          <Suspense fallback={<Skeleton className='h-full w-full' />}>
            <LazyTabSessionsPanel />
          </Suspense>
        );
      case 'quickClips':
        return (
          <Suspense fallback={<Skeleton className='h-full w-full' />}>
            <LazyQuickClipsPanel />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <aside className='w-full h-full md:w-80 lg:w-96 bg-card border-l border-border flex flex-col shrink-0 shadow-lg'>
      {/* No PanelTabs here anymore, content is directly rendered */}
      <div className='flex-1 p-3 overflow-y-auto scrollbar-modern'>
        {/* Enhanced with modern scrollbar styling */}
        {renderPanelContent()}
      </div>
    </aside>
  );
}
