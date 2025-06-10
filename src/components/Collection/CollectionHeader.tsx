import React from 'react';
import { Collection as CollectionType } from '../../types';
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
import { useAppStore } from '@/stores/appStore';
import { highlightText } from '@/lib/highlight';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

interface CollectionHeaderProps {
  collection: CollectionType;
  projectId: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEditModalOpen: () => void;
  showDragHandle?: boolean;
  dragHandleProps?: DraggableAttributes & {
    listeners?: SyntheticListenerMap;
  };
}

const CollectionHeader: React.FC<CollectionHeaderProps> = ({
  collection,
  projectId,
  isExpanded,
  onToggleExpanded,
  onEditModalOpen,
  showDragHandle = false,
  dragHandleProps,
}) => {
  const { id: collectionId, name } = collection;
  const moveCollection = useAppStore((state) => state.moveCollection);
  const openCollectionInNewWindow = useAppStore(
    (state) => state.openCollectionInNewWindow
  );
  const searchQuery = useAppStore((state) => state.searchQuery);

  return (
    <div className='flex items-center p-3'>
      {/* Drag handle */}
      {showDragHandle && (
        <div
          {...dragHandleProps}
          className='cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition-opacity p-1 hover:bg-secondary/50 rounded mr-1'
          title='Drag to reorder collection'
        >
          <GripVertical className='h-4 w-4 text-muted-foreground' />
        </div>
      )}
      <Button
        variant='ghost'
        size='icon'
        className='h-7 w-7'
        onClick={onToggleExpanded}
        aria-label={isExpanded ? 'Collapse collection' : 'Expand collection'}
      >
        {isExpanded ? (
          <ChevronDown className='h-5 w-5' />
        ) : (
          <ChevronRight className='h-5 w-5' />
        )}
      </Button>
      <h3
        className='font-semibold text-lg flex-1 ml-2 cursor-pointer'
        onClick={onToggleExpanded}
      >
        {highlightText(name, searchQuery)}
      </h3>
      <div className='flex items-center gap-2'>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          aria-label='Add new link'
        >
          <Plus className='h-5 w-5' />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              aria-label='Collection options'
            >
              <MoreHorizontal className='h-5 w-5' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={onEditModalOpen}>
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
              onClick={() => openCollectionInNewWindow(projectId, collectionId)}
            >
              <ExternalLink className='mr-2 h-4 w-4' />
              <span>Open in New Window</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default CollectionHeader;
