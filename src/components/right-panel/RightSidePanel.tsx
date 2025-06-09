"use client";

import { useAppStore } from "@/stores/appStore";
import PanelTabs from "./PanelTabs";
import OpenTabsPanelContent from "./panels/OpenTabsPanelContent";
import BookmarksPanelContent from "./panels/BookmarksPanelContent";
import NotesPanelContent from "./panels/NotesPanelContent";
import TodosPanelContent from "./panels/TodosPanelContent";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function RightSidePanel() {
  const { rightPanelTab } = useAppStore();

  const renderPanelContent = () => {
    switch (rightPanelTab) {
      case "quickLinks":
        return <OpenTabsPanelContent />;
      case "bookmarks":
        return <BookmarksPanelContent />;
      case "notes":
        return <NotesPanelContent />;
      case "todos":
        return <TodosPanelContent />;
      default:
        return null;
    }
  };

  return (
    <aside className="w-full md:w-80 lg:w-96 border-l border-border bg-card flex flex-col shrink-0">
      <PanelTabs />
      <ScrollArea className="flex-1 p-4">
        {renderPanelContent()}
      </ScrollArea>
    </aside>
  );
}
