import React, { useState } from 'react';
import { Collection as CollectionType, Link } from '../../types'; // Adjusted import path
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Edit,
  ArrowUp,
  ArrowDown,
  ExternalLink,
} from 'lucide-react';
import LinkItem from '../main-content/LinkItem';
import EditCollectionModal from '../modals/EditCollectionModal';
import { useAppStore } from '@/stores/appStore';

interface CollectionProps {
  collection: CollectionType;
  projectId: string;
}

const Collection: React.FC<CollectionProps> = ({ collection, projectId }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { id: collectionId, name, links } = collection;
  const moveCollection = useAppStore((state) => state.moveCollection);
  const openCollectionInNewWindow = useAppStore(
    (state) => state.openCollectionInNewWindow
  );

  return (
    <div className='bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50'>
      <div className='flex items-center p-3'>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronDown className='h-5 w-5' />
          ) : (
            <ChevronRight className='h-5 w-5' />
          )}
        </Button>
        <h3
          className='font-semibold text-lg flex-1 ml-2 cursor-pointer'
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {name}
        </h3>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='icon' className='h-7 w-7'>
            <Plus className='h-5 w-5' />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='h-7 w-7'>
                <MoreHorizontal className='h-5 w-5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => setIsEditModalOpen(true)}>
                <Edit className='mr-2 h-4 w-4' />
                <span>Edit Collection</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveCollection(projectId, collectionId, 'up')}
              >
                <ArrowUp className='mr-2 h-4 w-4' />
                <span>Move Up</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveCollection(projectId, collectionId, 'down')}
              >
                <ArrowDown className='mr-2 h-4 w-4' />
                <span>Move Down</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  openCollectionInNewWindow(projectId, collectionId)
                }
              >
                <ExternalLink className='mr-2 h-4 w-4' />
                <span>Open in New Window</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isExpanded && (
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
