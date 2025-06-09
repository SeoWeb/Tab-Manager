
"use client";

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { ChromeWindowInfo, ChromeTabInfo } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Edit2, PlusSquare, ExternalLink, GripVertical, Trash2, Check, X } from 'lucide-react';
import Image from 'next/image';
import { getFaviconUrl } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ChromeOpenTabsPanel() {
  const { chromeWindows, renameChromeWindow, addChromeWindowToCollections, activeProjectId } = useAppStore();
  const [editingWindowId, setEditingWindowId] = useState<number | null>(null);
  const [newWindowName, setNewWindowName] = useState('');

  const handleRenameWindow = (windowId: number) => {
    if (newWindowName.trim()) {
      renameChromeWindow(windowId, newWindowName.trim());
      setEditingWindowId(null);
      setNewWindowName('');
    }
  };

  const startRename = (window: ChromeWindowInfo) => {
    setEditingWindowId(window.id);
    setNewWindowName(window.name);
  };

  const cancelRename = () => {
    setEditingWindowId(null);
    setNewWindowName('');
  };

  const handleAddWindowAsCollection = (windowInfo: ChromeWindowInfo) => {
    if (activeProjectId) {
      addChromeWindowToCollections(windowInfo);
    } else {
      // Handle case where no project is active, e.g., show a toast
      alert("Please select or create a project first to add this window as a collection.");
    }
  };
  
  if (chromeWindows.length === 0) {
    return (
      <div className="text-center py-10">
        <img src="https://placehold.co/200x150.png?text=No+Open+Tabs" alt="No open tabs" className="mx-auto mb-4 rounded-md" data-ai-hint="empty state illustration"/>
        <p className="text-muted-foreground">No open Chrome tabs detected or mocked.</p>
        <p className="text-xs text-muted-foreground mt-2">(This feature usually requires a browser extension)</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
        <h2 className="text-xl font-semibold text-foreground px-1 pt-1 pb-2 border-b border-border">Open Chrome Tabs</h2>
        <ScrollArea className="flex-grow pr-1">
            <div className="space-y-4">
            {chromeWindows.map((window) => (
                <Card key={window.id} className="shadow-md">
                <CardHeader className="flex flex-row items-center justify-between p-3 bg-card-foreground/5 dark:bg-card-foreground/10">
                    {editingWindowId === window.id ? (
                    <div className="flex items-center gap-2 flex-grow">
                        <Input 
                        value={newWindowName} 
                        onChange={(e) => setNewWindowName(e.target.value)}
                        className="h-8 text-sm"
                        />
                        <Button variant="ghost" size="icon" onClick={() => handleRenameWindow(window.id)} className="h-8 w-8"><Check className="h-4 w-4 text-green-500"/></Button>
                        <Button variant="ghost" size="icon" onClick={cancelRename} className="h-8 w-8"><X className="h-4 w-4 text-red-500"/></Button>
                    </div>
                    ) : (
                    <CardTitle className="text-base font-medium text-foreground flex-grow truncate mr-2" title={window.name}>
                        {window.name}
                    </CardTitle>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                    {editingWindowId !== window.id && (
                        <Button variant="ghost" size="icon" onClick={() => startRename(window)} className="h-7 w-7" aria-label="Rename window">
                            <Edit2 className="h-4 w-4" />
                        </Button>
                    )}
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => handleAddWindowAsCollection(window)} 
                        className="h-7 w-7"
                        aria-label="Add window as new collection"
                        title="Add window as new collection"
                        disabled={!activeProjectId}
                    >
                        <PlusSquare className="h-4 w-4" />
                    </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-3 space-y-2 max-h-60 overflow-y-auto">
                    {window.tabs.map((tab) => (
                    <div key={tab.id} className="flex items-center gap-2 p-1.5 bg-background hover:bg-secondary/50 rounded-md border border-input text-xs group">
                        {/* Placeholder for D&D handle <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab" /> */}
                        <Image 
                        src={tab.favIconUrl || getFaviconUrl(tab.url)} 
                        alt="favicon" 
                        width={16} 
                        height={16} 
                        className="rounded shrink-0"
                        onError={(e) => (e.currentTarget.src = 'https://placehold.co/16x16.png')}
                        unoptimized
                        />
                        <a 
                        href={tab.url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="flex-1 truncate text-primary hover:underline" 
                        title={tab.url}
                        >
                        {tab.title}
                        </a>
                        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" asChild>
                            <a href={tab.url} target="_blank" rel="noopener noreferrer" aria-label="Open tab in new window">
                                <ExternalLink className="h-3 w-3 text-muted-foreground"/>
                            </a>
                        </Button>
                        {/* Placeholder for D&D: On drag start, pass tab info. Highlight collections on hover. If URL exists, show red. */}
                    </div>
                    ))}
                </CardContent>
                </Card>
            ))}
            </div>
        </ScrollArea>
        <p className="text-xs text-muted-foreground px-1 pt-2 text-center">Simulated Chrome tabs. Drag-and-drop to collections coming soon.</p>
    </div>
  );
}
