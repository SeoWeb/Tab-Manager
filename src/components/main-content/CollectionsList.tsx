// src/components/main-content/CollectionsList.tsx
import React from 'react';
import { Project } from '@/types';
// import CollectionItem from './CollectionItem'; // For later use
// import AddCollectionButton from './AddCollectionButton'; // For later use

interface CollectionsListProps {
  project: Project;
}

const CollectionsList: React.FC<CollectionsListProps> = ({ project }) => {
  if (!project.collections || project.collections.length === 0) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-8">
        <p>This project has no collections yet.</p>
        {/* <AddCollectionButton projectId={project.id} /> */} {/* Offer to add one */}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {project.collections.map((collection) => (
        // <CollectionItem key={collection.id} collection={collection} />
        <div key={collection.id} className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200">{collection.name}</h3>
          {/* Display links later */}
        </div>
      ))}
    </div>
  );
};

export default CollectionsList;
