import React from 'react';
import { Collection } from '@/types'; // Assuming Collection type is in @/types
// import { Button } from '@/components/ui/button'; // For future action buttons
// import { MoreHorizontalIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'; // For future icons

interface CollectionItemProps {
  collection: Collection;
  // projectId: string; // To associate actions with the parent project
}

const CollectionItem: React.FC<CollectionItemProps> = ({
  collection,
  // projectId,
}) => {
  // Placeholder state for expansion - will be implemented later
  // const [isExpanded, setIsExpanded] = useState(true);

  if (!collection) {
    return null; // Or some fallback UI
  }

  return (
    <div className='bg-white dark:bg-gray-800 shadow-md rounded-lg border border-gray-200 dark:border-gray-700'>
      {/* Collection Header */}
      <div className='flex items-center justify-between p-3 md:p-4 border-b border-gray-200 dark:border-gray-700'>
        <h3
          className='text-lg font-semibold text-gray-800 dark:text-gray-100 truncate'
          title={collection.name}
        >
          {collection.name}
        </h3>
        <div className='flex items-center space-x-2'>
          {/* Placeholder for expand/collapse toggle */}
          {/* <Button variant="ghost" size="icon" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
          </Button> */}
          {/* Placeholder for action menu (edit, delete) */}
          {/* <Button variant="ghost" size="icon">
            <MoreHorizontalIcon className="h-5 w-5" />
          </Button> */}
        </div>
      </div>

      {/* Collection Content (Links Area) - Visible if expanded */}
      {/* {isExpanded && ( */}
      <div className='p-3 md:p-4'>
        {collection.links && collection.links.length > 0 ? (
          <ul className='space-y-2'>
            {collection.links.map((link) => (
              <li
                key={link.id}
                className='text-sm text-gray-600 dark:text-gray-400 p-2 rounded bg-gray-50 dark:bg-gray-700/50'
              >
                {link.title} -{' '}
                <a
                  href={link.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 hover:underline'
                >
                  {link.url}
                </a>
                {/* Basic link display for now, will become LinkItem component later. Used link.title based on type definition */}
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            This collection has no links yet.
          </p>
        )}
      </div>
      {/* )} */}
    </div>
  );
};

export default CollectionItem;
