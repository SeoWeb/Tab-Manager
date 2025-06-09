import React from 'react';
import { Collection as CollectionType, Link } from '../../types';
import LinkItem from '../main-content/LinkItem';

interface CollectionContentProps {
  collection: CollectionType;
  projectId: string;
}

const CollectionContent: React.FC<CollectionContentProps> = ({
  collection,
  projectId,
}) => {
  const { id: collectionId, links } = collection;

  return (
    <div className='flex p-3 gap-2'>
      {links.length > 0 ? (
        links.map((link: Link) => (
          <LinkItem
            key={link.id}
            link={link}
            projectId={projectId}
            collectionId={collectionId}
          />
        ))
      ) : (
        <p className='text-sm text-gray-500 dark:text-gray-400 px-3 py-2'>
          No links in this collection yet.
        </p>
      )}
    </div>
  );
};

export default CollectionContent;
