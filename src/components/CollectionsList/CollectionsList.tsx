import React from 'react';
import Collection from '../Collection';
import { useStore } from '../../store/store';
import { Collection as CollectionType } // Renaming to avoid conflict
from '../../types';

const CollectionsList: React.FC = () => {
  const activeProject = useStore((state) => state.getActiveProject());
  const collections = activeProject?.collections || [];

  if (!activeProject) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>No active project selected or project not found.</p>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>No collections yet. Create one to get started!</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {collections.map((collection: CollectionType) => (
        <Collection key={collection.id} collection={collection} />
      ))}
    </div>
  );
};

export default CollectionsList;
