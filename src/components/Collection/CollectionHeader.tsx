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
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

interface CollectionHeaderProps {
  collection: CollectionType;
  projectId: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEditModalOpen: () => void;
}

const CollectionHeader: React.FC<CollectionHeaderProps> = ({
  collection,
  projectId,
  isExpanded,
  onToggleExpanded,
  onEditModalOpen,
}) => {
  const { id: collectionId, name } = collection;
  const moveCollection = useAppStore((state) => state.moveCollection);
  const openCollectionInNewWindow = useAppStore(
    (state) => state.openCollectionInNewWindow
  );

  return (
    <div className='flex items-center p-3'>
      <Button
        variant='ghost'
        size='icon'
        className='h-7 w-7'
        onClick={onToggleExpanded}
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
