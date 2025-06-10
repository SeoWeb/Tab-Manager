'use client';

import { useActiveVerticalTabId } from '@/hooks/useAppStoreWithDefaults';
import BookmarksPanelContent from '@/components/right-panel/panels/BookmarksPanelContent';
import NotesPanelContent from '@/components/right-panel/panels/NotesPanelContent';
import TodosPanelContent from '@/components/right-panel/panels/TodosPanelContent';
import ChromeOpenTabsPanel from './panels/ChromeOpenTabsPanel'; // New panel
import { TabSessionsPanel } from './panels/TabSessionsPanel';

export default function RightContentPanel() {
  const activeVerticalTabId = useActiveVerticalTabId();

  const renderPanelContent = () => {
    switch (activeVerticalTabId) {
      case 'openTabs':
        return <ChromeOpenTabsPanel />;
      case 'bookmarks':
        return <BookmarksPanelContent />;
      case 'notes':
        return <NotesPanelContent />;
      case 'todos':
        return <TodosPanelContent />;
      case 'sessions':
        return <TabSessionsPanel />;
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
