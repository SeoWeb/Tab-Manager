import React, { useState, useCallback } from 'react';
import { Collection as CollectionType, Link } from '../../types';
import LinkItem from '../main-content/LinkItem';
import { useHotkeys } from '@/hooks/useHotkeys';

interface CollectionContentProps {
  collection: CollectionType;
  projectId: string;
}

const CollectionContent: React.FC<CollectionContentProps> = ({
  collection,
  projectId,
}) => {
  const { id: collectionId, links } = collection;
  const [focusedLinkIndex, setFocusedLinkIndex] = useState(-1);

  const handleNavigation = useCallback(
    (direction: 'up' | 'down') => {
      if (links.length === 0) return;
      const newIndex =
        direction === 'up'
          ? Math.max(0, focusedLinkIndex - 1)
          : Math.min(links.length - 1, focusedLinkIndex + 1);
      setFocusedLinkIndex(newIndex);
    },
    [focusedLinkIndex, links.length]
  );

  useHotkeys('up', () => handleNavigation('up'));
  useHotkeys('down', () => handleNavigation('down'));

  return (
    <div className='flex p-3 gap-2'>
      {links.length > 0 ? (
        links.map((link: Link, index: number) => (
          <div
            key={link.id}
            className={
              index === focusedLinkIndex ? 'ring-2 ring-primary rounded-lg' : ''
            }
          >
            <LinkItem
              link={link}
              projectId={projectId}
              collectionId={collectionId}
            />
          </div>
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
