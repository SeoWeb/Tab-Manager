"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/stores/appStore";
import { Link2, Bookmark, FileText, ListTodo } from "lucide-react";

export default function PanelTabs() {
  const { rightPanelTab, setRightPanelTab } = useAppStore();

  return (
    <div className="p-2 border-b border-border">
      <Tabs value={rightPanelTab} onValueChange={(value) => setRightPanelTab(value as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-auto">
          <TabsTrigger value="quickLinks" className="flex-col h-auto py-2 gap-1">
            <Link2 className="h-4 w-4" />
            <span className="text-xs">Quick</span>
          </TabsTrigger>
          <TabsTrigger value="bookmarks" className="flex-col h-auto py-2 gap-1">
            <Bookmark className="h-4 w-4" />
            <span className="text-xs">Links</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex-col h-auto py-2 gap-1">
            <FileText className="h-4 w-4" />
            <span className="text-xs">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="todos" className="flex-col h-auto py-2 gap-1">
            <ListTodo className="h-4 w-4" />
            <span className="text-xs">Todos</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
