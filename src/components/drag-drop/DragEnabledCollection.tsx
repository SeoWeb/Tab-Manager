import React, { useState } from 'react';
import { Collection as CollectionType } from '@/types';
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
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableLinkItem } from './SortableLinkItem';
import EditCollectionModal from '../modals/EditCollectionModal';
import { useAppStore } from '@/stores/appStore';

interface DragEnabledCollectionProps {
  collection: CollectionType;
  projectId: string;
}

const DragEnabledCollection: React.FC<DragEnabledCollectionProps> = ({
  collection,
  projectId,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { id: collectionId, name, links } = collection;
  const moveCollection = useAppStore((state) => state.moveCollection);
  const openCollectionInNewWindow = useAppStore(
    (state) => state.openCollectionInNewWindow
  );
  const openAddLinkModal = useAppStore((state) => state.openAddLinkModal);

  const { setNodeRef, isOver } = useDroppable({
    id: `collection-${collection.id}`,
    data: {
      type: 'collection',
      collectionId: collection.id,
      projectId,
    },
  });

  const linkIds = links.map((link) => link.id);

  return (
    <div
      ref={setNodeRef}
      className={`bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50 transition-colors duration-200 ${
        isOver ? 'bg-accent/20 border-accent border-2 border-dashed' : ''
      }`}
    >
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
        <h3 className='flex-1 text-lg font-semibold text-gray-800 dark:text-gray-200 ml-2'>
          {name}
        </h3>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={() => openAddLinkModal(collectionId)}
          >
            <Plus className='h-4 w-4' />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='h-7 w-7'>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => setIsEditModalOpen(true)}>
                <Edit className='mr-2 h-4 w-4' />
                Edit Collection
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveCollection(projectId, collectionId, 'up')}
              >
                <ArrowUp className='mr-2 h-4 w-4' />
                Move Up
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveCollection(projectId, collectionId, 'down')}
              >
                <ArrowDown className='mr-2 h-4 w-4' />
                Move Down
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  openCollectionInNewWindow(projectId, collectionId)
                }
              >
                <ExternalLink className='mr-2 h-4 w-4' />
                Open in New Window
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (
        <div className='px-3 pb-3'>
          {links.length === 0 ? (
            <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
              <p>No links in this collection yet.</p>
              <Button
                variant='outline'
                size='sm'
                className='mt-2'
                onClick={() => openAddLinkModal(collectionId)}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add First Link
              </Button>
            </div>
          ) : (
            <SortableContext
              items={linkIds}
              strategy={verticalListSortingStrategy}
            >
              <div className='space-y-2'>
                {links.map((link) => (
                  <SortableLinkItem
                    key={link.id}
                    link={link}
                    projectId={projectId}
                    collectionId={collectionId}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </div>
      )}

      <EditCollectionModal
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        collection={collection}
        projectId={projectId}
      >
        <div />
      </EditCollectionModal>
    </div>
  );
};

export default DragEnabledCollection;
