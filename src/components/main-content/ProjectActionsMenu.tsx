import React, { useState } from 'react';
import { Project } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SettingsIcon,
  RefreshCw,
  CloudUpload,
  CloudOff,
  Users,
  Download,
  Upload,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
const EditProjectModal = React.lazy(
  () => import('@/components/modals/EditProjectModal')
);
const ExportProjectModal = React.lazy(
  () => import('@/components/modals/ExportProjectModal')
);
const ImportProjectModal = React.lazy(
  () => import('@/components/modals/ImportProjectModal')
);
import { ProjectCollaborationModal } from '@/components/cloud-sync/ProjectCollaborationModal';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import {
  syncProjectNow,
  convertProjectToCloud,
  disconnectProjectFromCloud,
} from '@/lib/cloudflareSync/orchestrator';
import { canEdit, canDeleteProject } from '@/lib/cloudflareSync/roles';

interface ProjectActionsMenuProps {
  project: Project;
}

const ProjectActionsMenu: React.FC<ProjectActionsMenuProps> = ({ project }) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudSyncEnabled = useAppStore((state) => state.cloudSync.enabled);
  const { toast } = useToast();

  // Viewers (a known low cloud role) can't mutate project data; the backend
  // would reject these anyway. Local-only projects have no role → full control.
  const readOnly = !canEdit(project.cloudRole, project.cloudEnabled);
  const deleteDisabled = !canDeleteProject(
    project.cloudRole,
    project.cloudEnabled
  );

  const handleEditProjectTrigger = () => {
    setIsEditModalOpen(true);
  };

  const handleDeleteProjectTrigger = () => {
    // This will also open the EditProjectModal, where the user can then click the delete button.
    setIsEditModalOpen(true);
  };

  const handleSyncNow = async () => {
    setCloudBusy(true);
    try {
      await syncProjectNow(project.id);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleConvertToCloud = async () => {
    setCloudBusy(true);
    try {
      await convertProjectToCloud(project.id);
      toast({
        title: 'Converted to cloud',
        description: `'${project.name}' is now syncing to the cloud.`,
      });
    } catch (error) {
      toast({
        title: 'Conversion failed',
        description:
          error instanceof Error ? error.message : 'Could not convert project.',
        variant: 'destructive',
      });
    } finally {
      setCloudBusy(false);
    }
  };

  const handleDisconnectFromCloud = async () => {
    setCloudBusy(true);
    try {
      await disconnectProjectFromCloud(project.id);
      toast({
        title: 'Disconnected from cloud',
        description: `'${project.name}' is now local-only. The server copy is kept.`,
      });
    } finally {
      setCloudBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label='Project settings'>
            <SettingsIcon className='h-5 w-5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Project Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleEditProjectTrigger}
            disabled={readOnly}
          >
            Edit Project
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsExportModalOpen(true)}>
            <Download className='mr-2 h-4 w-4' />
            Export
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsImportModalOpen(true)}>
            <Upload className='mr-2 h-4 w-4' />
            Import
          </DropdownMenuItem>

          {/* Cloud sync actions. Only relevant when cloud sync is connected. */}
          {cloudSyncEnabled && (
            <>
              <DropdownMenuSeparator />
              {project.cloudEnabled ? (
                <>
                  <DropdownMenuItem onClick={() => setIsShareModalOpen(true)}>
                    <Users className='mr-2 h-4 w-4' />
                    Share &amp; members
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleSyncNow}
                    disabled={cloudBusy}
                  >
                    <RefreshCw className='mr-2 h-4 w-4' />
                    Sync now
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDisconnectFromCloud}
                    disabled={cloudBusy}
                    className='text-amber-600 focus:text-amber-600'
                  >
                    <CloudOff className='mr-2 h-4 w-4' />
                    Disconnect from cloud
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  onClick={handleConvertToCloud}
                  disabled={cloudBusy}
                >
                  <CloudUpload className='mr-2 h-4 w-4' />
                  Convert to cloud project
                </DropdownMenuItem>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDeleteProjectTrigger}
            disabled={deleteDisabled}
            className='text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-700/20 dark:focus:text-red-500'
          >
            Delete Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Project Modal Instance */}
      <React.Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <EditProjectModal
          project={project}
          isOpen={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
        >
          <div />
        </EditProjectModal>
      </React.Suspense>

      {/* Share & members — Phase 4 collaboration. Cloud projects only. */}
      {project.cloudEnabled && (
        <ProjectCollaborationModal
          project={project}
          isOpen={isShareModalOpen}
          onOpenChange={setIsShareModalOpen}
        />
      )}

      {/* Export / Import — per-project data portability. */}
      <React.Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <ExportProjectModal
          project={project}
          isOpen={isExportModalOpen}
          onOpenChange={setIsExportModalOpen}
        />
      </React.Suspense>
      <React.Suspense fallback={<Skeleton className='h-8 w-8' />}>
        <ImportProjectModal
          isOpen={isImportModalOpen}
          onOpenChange={setIsImportModalOpen}
        />
      </React.Suspense>
    </>
  );
};

export default ProjectActionsMenu;
