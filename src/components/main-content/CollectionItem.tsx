"use client";

import type { Collection } from "@/types";
import { useAppStore } from "@/stores/appStore";
import LinkItem from "./LinkItem";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { PlusCircle, ChevronDown, ChevronUp, Edit3, Trash2, BrainCircuit } from "lucide-react";
import SuggestNameButton from "./SuggestNameButton"; // Import the new component


interface CollectionItemProps {
  collection: Collection;
  projectId: string;
}

export default function CollectionItem({ collection, projectId }: CollectionItemProps) {
  const { updateCollection, deleteCollection, openAddLinkModal } = useAppStore();

  const toggleMinimize = () => {
    updateCollection(projectId, collection.id, { isMinimized: !collection.isMinimized });
  };

  // Sort links by order if needed, default to array order for now
  const sortedLinks = [...collection.links].sort((a, b) => a.order - b.order);

  return (
    <Card className="shadow-lg rounded-xl overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between p-4 bg-card-foreground/5 dark:bg-card-foreground/10">
        <CardTitle className="text-lg font-semibold text-foreground flex-grow truncate mr-2">{collection.name}</CardTitle>
        <div className="flex items-center gap-1 shrink-0">
          <SuggestNameButton projectId={projectId} collectionId={collection.id} currentLinks={collection.links} />
          {/* <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit collection">
            <Edit3 className="h-4 w-4" />
          </Button> */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8" 
            onClick={() => deleteCollection(projectId, collection.id)}
            aria-label="Delete collection"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleMinimize} className="h-8 w-8" aria-label={collection.isMinimized ? "Expand collection" : "Minimize collection"}>
            {collection.isMinimized ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
          </Button>
        </div>
      </CardHeader>
      {!collection.isMinimized && (
        <>
          <CardContent className="p-4 space-y-3">
            {sortedLinks.length > 0 ? (
              sortedLinks.map((link) => (
                <LinkItem key={link.id} link={link} projectId={projectId} collectionId={collection.id} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No links in this collection yet.</p>
            )}
          </CardContent>
          <CardFooter className="p-4 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => openAddLinkModal(collection.id)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Link
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
