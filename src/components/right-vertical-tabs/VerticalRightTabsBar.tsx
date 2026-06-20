'use client';

import { Button } from '@/components/ui/button';
import {
  useActiveVerticalTabId,
  useToggleRightContentPanel,
  useIsRightContentPanelOpen,
} from '@/hooks/useAppStoreWithDefaults';
import type { VerticalTabId } from '@/types';
import { cn } from '@/lib/utils';
import { PanelRight, Bookmark, FileText } from 'lucide-react'; // Using PanelRight for Open Tabs

const TABS: { id: VerticalTabId; label: string; icon: React.ElementType }[] = [
  { id: 'openTabs', label: 'Open Tabs', icon: PanelRight },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'notes', label: 'Notes', icon: FileText },
];

export default function VerticalRightTabsBar() {
  const activeVerticalTabId = useActiveVerticalTabId();
  const toggleRightContentPanel = useToggleRightContentPanel();
  const isRightContentPanelOpen = useIsRightContentPanelOpen();

  const handleTabClick = (tabId: VerticalTabId) => {
    toggleRightContentPanel(undefined, tabId);
  };

  return (
    <div className='flex flex-col h-full bg-card border-l border-border shrink-0 p-2 items-center gap-0 shadow-lg'>
      {TABS.map((tab) => (
        <Button
          key={tab.id}
          variant='ghost'
          size='custom'
          className={cn(
            'flex flex-col items-center justify-center p-3 rounded-md transition-colors duration-200',
            activeVerticalTabId === tab.id && isRightContentPanelOpen
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-primary'
          )}
          onClick={() => handleTabClick(tab.id)}
          title={tab.label}
          aria-label={tab.label}
          aria-pressed={
            activeVerticalTabId === tab.id && isRightContentPanelOpen
          }
        >
          <tab.icon className='h-5 w-5 mb-1' />
          <span
            className='text-[12px] font-medium leading-tight'
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            {tab.label}
          </span>
        </Button>
      ))}
    </div>
  );
}
