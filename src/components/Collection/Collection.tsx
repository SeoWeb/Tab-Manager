import React, { useState } from 'react';
import { Collection as CollectionType } from '../../types';
import CollectionHeader from './CollectionHeader';
import CollectionContent from './CollectionContent';
import EditCollectionModal from '../modals/EditCollectionModal';

interface CollectionProps {
  collection: CollectionType;
  projectId: string;
}

const Collection: React.FC<CollectionProps> = ({ collection, projectId }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  return (
    <div className='bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50'>
      <CollectionHeader
        collection={collection}
        projectId={projectId}
        isExpanded={isExpanded}
        onToggleExpanded={() => setIsExpanded(!isExpanded)}
        onEditModalOpen={() => setIsEditModalOpen(true)}
      />

      {isExpanded && (
        <CollectionContent collection={collection} projectId={projectId} />
      )}

      <EditCollectionModal
        projectId={projectId}
        collection={collection}
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      >
        <></>
      </EditCollectionModal>
    </div>
  );
};

export default Collection;
