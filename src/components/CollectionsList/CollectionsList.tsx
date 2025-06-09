import React from 'react';
import {
  useProjects,
  useActiveProjectId,
} from '@/hooks/useAppStoreWithDefaults';
import CollectionComponent from '@/components/Collection';
import { Collection as CollectionType } from '@/types';

const CollectionsList: React.FC = () => {
  const activeProjectId = useActiveProjectId();
  const projects = useProjects();

  const activeProject = projects.find((p) => p.id === activeProjectId);

  if (!activeProject) {
    return (
      <p className='text-center text-gray-500 py-4'>
        Select a project to see collections.
      </p>
    );
  }

  const collections = activeProject.collections;

  if (!collections || collections.length === 0) {
    return (
      <p className='text-center text-gray-500 py-4'>
        No collections in this project.
      </p>
    );
  }

  return (
    <div className='space-y-4 p-4'>
      {collections.map((collection: CollectionType) => (
        <CollectionComponent
          key={collection.id}
          collection={collection}
          projectId={activeProjectId!}
        />
      ))}
    </div>
  );
};

export default CollectionsList;
