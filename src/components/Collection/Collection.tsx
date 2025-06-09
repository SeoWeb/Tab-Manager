import React, { useState, useCallback } from 'react';
import { Collection as CollectionType } from '../../types';
import { useHotkeys } from '@/hooks/useHotkeys';
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

  const handleLinkOpening = useCallback(
    (index: number) => {
      if (collection.links[index]) {
        window.open(collection.links[index].url, '_blank');
      }
    },
    [collection.links]
  );

  for (let i = 0; i < 9; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkeys(`${i + 1}`, () => handleLinkOpening(i));
  }

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
