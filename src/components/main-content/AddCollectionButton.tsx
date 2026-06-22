'use client';

import { Button } from '@/components/ui/button';
import { PlusSquare } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { canEdit } from '@/lib/cloudflareSync/roles';

export default function AddCollectionButton() {
  const openAddCollectionModal = useAppStore(
    (state) => state.openAddCollectionModal
  );
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeProject = useAppStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );
  const activeProjectRole = activeProject?.cloudRole;
  const activeProjectEnabled = activeProject?.cloudEnabled;

  // Viewers on a shared cloud project can't add collections; the backend would
  // reject it. Local-only projects (no role) stay fully editable.
  const readOnly =
    activeProjectId !== null &&
    !canEdit(activeProjectRole, activeProjectEnabled);

  return (
    <Button
      variant='default'
      onClick={openAddCollectionModal}
      disabled={readOnly}
      title={readOnly ? 'You need edit access to add collections' : undefined}
      className='w-full md:w-auto shadow-md'
    >
      <PlusSquare className='mr-2 h-5 w-5' />
      Add New Collection
    </Button>
  );
}
