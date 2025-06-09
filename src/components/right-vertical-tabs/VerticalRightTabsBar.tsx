'use client';

import { Button } from '@/components/ui/button';
import {
  useActiveVerticalTabId,
  useToggleRightContentPanel,
  useIsRightContentPanelOpen,
} from '@/hooks/useAppStoreWithDefaults';
import type { VerticalTabId } from '@/types';
import { cn } from '@/lib/utils';
import { PanelRight, Bookmark, FileText, ListChecks } from 'lucide-react'; // Using PanelRight for Open Tabs

const TABS: { id: VerticalTabId; label: string; icon: React.ElementType }[] = [
  { id: 'openTabs', label: 'Open Tabs', icon: PanelRight },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'todos', label: 'Tasks', icon: ListChecks },
];

export default function VerticalRightTabsBar() {
  const activeVerticalTabId = useActiveVerticalTabId();
  const toggleRightContentPanel = useToggleRightContentPanel();
  const isRightContentPanelOpen = useIsRightContentPanelOpen();

  const handleTabClick = (tabId: VerticalTabId) => {
    toggleRightContentPanel(undefined, tabId);
  };

  return (
    <div className='flex flex-col h-full w-12 bg-card border-l border-border shrink-0 py-4 items-center space-y-2 shadow-md'>
      {TABS.map((tab) => (
        <Button
          key={tab.id}
          variant='ghost'
          size='icon'
          className={cn(
            'w-10 h-16 flex flex-col items-center justify-center p-1 rounded-md hover:bg-accent/50',
            activeVerticalTabId === tab.id && isRightContentPanelOpen
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground'
          )}
          onClick={() => handleTabClick(tab.id)}
          title={tab.label}
          aria-label={tab.label}
          aria-pressed={
            activeVerticalTabId === tab.id && isRightContentPanelOpen
          }
        >
          <tab.icon className='h-5 w-5 mb-0.5' />
          <span
            className='text-[10px] leading-tight'
            style={{ writingMode: 'vertical-rl', whiteSpace: 'nowrap' }}
          >
            {tab.label}
          </span>
        </Button>
      ))}
    </div>
  );
}
