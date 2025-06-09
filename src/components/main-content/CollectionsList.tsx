"use client";

import type { Project } from "@/types";
import CollectionItem from "./CollectionItem";
import AddCollectionButton from "./AddCollectionButton";

interface CollectionsListProps {
  project: Project;
}

export default function CollectionsList({ project }: CollectionsListProps) {
  if (project.collections.length === 0) {
    return (
      <div className="text-center py-10">
        <img src="https://placehold.co/200x150.png?text=No+Collections" alt="No collections" className="mx-auto mb-4 rounded-md" data-ai-hint="empty state illustration"/>
        <p className="text-muted-foreground mb-4">This project has no collections yet.</p>
        <AddCollectionButton />
      </div>
    );
  }

  // Sort collections by order if needed, default to array order for now
  const sortedCollections = [...project.collections].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-6">
      {sortedCollections.map((collection) => (
        <CollectionItem key={collection.id} collection={collection} projectId={project.id} />
      ))}
      <div className="mt-6">
        <AddCollectionButton />
      </div>
    </div>
  );
}
