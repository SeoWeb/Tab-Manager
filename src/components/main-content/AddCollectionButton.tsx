'use client';

import { Button } from '@/components/ui/button';
import { PlusSquare } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

export default function AddCollectionButton() {
  const openAddCollectionModal = useAppStore(
    (state) => state.openAddCollectionModal
  );
  return (
    <Button
      variant='default'
      onClick={openAddCollectionModal}
      className='w-full md:w-auto shadow-md'
    >
      <PlusSquare className='mr-2 h-5 w-5' />
      Add New Collection
    </Button>
  );
}
