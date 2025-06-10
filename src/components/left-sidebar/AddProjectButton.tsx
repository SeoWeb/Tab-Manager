import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';
import AddProjectModal from '@/components/modals/AddProjectModal';
import { useSidebarState } from '@/hooks/useSidebarState';

const AddProjectButton: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { open: sidebarOpen } = useSidebarState();

  return (
    <>
      <AddProjectModal isOpen={isModalOpen} onOpenChange={setIsModalOpen}>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-start text-sm'
          onClick={() => setIsModalOpen(true)}
        >
          <PlusIcon className='mr-2 h-4 w-4' />
          {sidebarOpen ? 'Add Project' : ''}
        </Button>
      </AddProjectModal>
    </>
  );
};

export default AddProjectButton;
