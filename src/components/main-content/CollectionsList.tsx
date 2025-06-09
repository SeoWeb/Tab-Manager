// src/components/main-content/CollectionsList.tsx
import React from 'react';
import { Project, Collection } from '@/types'; // Import Collection type
import CollectionComponent from '@/components/Collection'; // Import the component created in the first subtask
// import AddCollectionButton from './AddCollectionButton'; // For later use

interface CollectionsListProps {
  project: Project;
}

const CollectionsList: React.FC<CollectionsListProps> = ({ project }) => {
  if (!project.collections || project.collections.length === 0) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400 py-8'>
        <p>This project has no collections yet.</p>
        {/* <AddCollectionButton projectId={project.id} /> */}{' '}
        {/* Offer to add one */}
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {project.collections.map(
        (
          collection: Collection // Added type for collection
        ) => (
          <CollectionComponent
            key={collection.id}
            collection={collection}
            projectId={project.id}
          />
        )
      )}
    </div>
  );
};

export default CollectionsList;
