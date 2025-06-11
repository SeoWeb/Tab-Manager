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
  GripVertical,
} from 'lucide-react';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableLinkItem } from './SortableLinkItem';
import { LinkDropPlaceholder } from './LinkDropPlaceholder';
import { useDragAndDropContext } from './GlobalDragDropProvider';
import EditCollectionModal from '../modals/EditCollectionModal';
import { useAppStore } from '@/stores/appStore';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

interface DragEnabledCollectionProps {
  collection: CollectionType;
  projectId: string;
  showDragHandle?: boolean;
  dragHandleProps?: DraggableAttributes & {
    listeners?: SyntheticListenerMap;
  };
}

const DragEnabledCollection: React.FC<DragEnabledCollectionProps> = ({
  collection,
  projectId,
  showDragHandle = false,
  dragHandleProps,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { id: collectionId, name, links } = collection;
  const moveCollection = useAppStore((state) => state.moveCollection);
  const openCollectionInNewWindow = useAppStore(
    (state) => state.openCollectionInNewWindow
  );
  const openAddLinkModal = useAppStore((state) => state.openAddLinkModal);
  const { linkDropPlaceholder } = useDragAndDropContext();

  const { setNodeRef, isOver, active } = useDroppable({
    id: `collection-${collection.id}`,
    data: {
      type: 'collection',
      collectionId: collection.id,
      projectId,
      collection,
    },
  });

  // Check if we're dragging a tab/bookmark and if URL already exists
  const isDraggingExternalItem =
    active?.data?.current?.type === 'tab' ||
    active?.data?.current?.type === 'bookmark';
  const draggedUrl =
    active?.data?.current?.tab?.url || active?.data?.current?.bookmark?.url;
  const urlExists = draggedUrl && links.some((link) => link.url === draggedUrl);

  const linkIds = links.map((link) => link.id);

  return (
    <div
      ref={setNodeRef}
      className={`relative bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50 transition-colors duration-200 ${
        isDraggingExternalItem && isOver && !urlExists
          ? 'bg-primary/10 border-primary border-2 border-dashed ring-2 ring-primary/50'
          : isDraggingExternalItem && isOver && urlExists
            ? 'bg-red-500/20 border-red-500 border-2 border-dashed ring-2 ring-red-500/50'
            : isOver
              ? 'bg-accent/20 border-accent border-2 border-dashed'
              : ''
      }`}
    >
      <div className='flex items-center p-1'>
        {/* Drag handle */}
        {showDragHandle && (
          <div
            {...dragHandleProps}
            className='cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition-opacity p-1 hover:bg-secondary/50 rounded mr-1'
            title='Drag to reorder collection'
          >
            <GripVertical className='h-5 w-5 text-muted-foreground' />
          </div>
        )}
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6'
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronDown className='h-4 w-4' />
          ) : (
            <ChevronRight className='h-4 w-4' />
          )}
        </Button>
        <h3 className='flex-1 text-base font-semibold text-gray-800 dark:text-gray-200 ml-1'>
          {name}
        </h3>
        <div className='flex items-center gap-0.5'>
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6'
            onClick={() => openAddLinkModal(collectionId)}
          >
            <Plus className='h-4 w-4' />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='h-6 w-6'>
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
        <div className='px-2 pb-2'>
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
            <SortableContext items={linkIds} strategy={rectSortingStrategy}>
              <div className='flex flex-wrap gap-2'>
                {links.map((link, index) => (
                  <React.Fragment key={link.id}>
                    <LinkDropPlaceholder
                      isVisible={
                        linkDropPlaceholder?.collectionId === collectionId &&
                        linkDropPlaceholder?.position === index
                      }
                    />
                    <SortableLinkItem
                      link={link}
                      projectId={projectId}
                      collectionId={collectionId}
                    />
                  </React.Fragment>
                ))}
                <LinkDropPlaceholder
                  isVisible={
                    linkDropPlaceholder?.collectionId === collectionId &&
                    linkDropPlaceholder?.position === links.length
                  }
                />
              </div>
            </SortableContext>
          )}
        </div>
      )}

      {/* Drop indicator overlay for external items */}
      {isDraggingExternalItem && isOver && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/90 rounded-lg border-2 border-dashed z-20'>
          <div className='text-center p-4'>
            {urlExists ? (
              <div className='text-red-600'>
                <div className='font-medium text-lg'>⚠️ URL Already Exists</div>
                <div className='text-sm mt-1'>
                  This link is already in &quot;{name}&quot;
                </div>
              </div>
            ) : (
              <div className='text-primary'>
                <div className='font-medium text-lg'>📁 Drop to Add</div>
                <div className='text-sm mt-1'>
                  Add &quot;
                  {active?.data?.current?.tab?.title ||
                    active?.data?.current?.bookmark?.title}
                  &quot; to {name}
                </div>
              </div>
            )}
          </div>
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
