import React, { useState, useEffect } from 'react';
import { CloudUpload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Project } from '@/types';
import { useToast } from '@/hooks/use-toast';
import ProjectForm from './ProjectForm';
import DeleteProjectConfirmation from './DeleteProjectConfirmation';
import { CloudSyncConnectModal } from '@/components/cloud-sync/CloudSyncConnectModal';
import { convertProjectToCloud } from '@/lib/cloudflareSync/orchestrator';

interface EditProjectModalProps {
  project: Project;
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EditProjectModal: React.FC<EditProjectModalProps> = ({
  project,
  children,
  isOpen,
  onOpenChange,
}) => {
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('');
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);

  const cloudSyncEnabled = useAppStore((state) => state.cloudSync.enabled);
  const { updateProject, deleteProject } = useAppStore(
    useShallow((state) => ({
      updateProject: state.updateProject,
      deleteProject: state.deleteProject,
    }))
  );
  const { toast } = useToast();

  useEffect(() => {
    if (project) {
      setProjectName(project.name);
      setProjectColor(project.color || '#FFFFFF');
    }
  }, [project, isOpen]);

  const handleSubmit = () => {
    if (projectName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    updateProject(project.id, {
      name: projectName.trim(),
      color: projectColor,
    });
    toast({
      title: 'Project Updated',
      description: `'${projectName.trim()}' has been successfully updated.`,
    });
    if (onOpenChange) onOpenChange(false);
  };

  const handleDeleteConfirmed = () => {
    deleteProject(project.id);
    toast({
      title: 'Project Deleted',
      description: `'${project.name}' has been successfully deleted.`,
      variant: 'destructive',
    });
    if (onOpenChange) onOpenChange(false);
  };

  const handleSyncToCloud = async () => {
    if (cloudSyncEnabled) {
      setCloudBusy(true);
      try {
        await convertProjectToCloud(project.id);
        toast({
          title: 'Converted to cloud',
          description: `'${project.name}' is now syncing to the cloud.`,
        });
        if (onOpenChange) onOpenChange(false);
      } catch (error) {
        toast({
          title: 'Conversion failed',
          description:
            error instanceof Error
              ? error.message
              : 'Could not convert project.',
          variant: 'destructive',
        });
      } finally {
        setCloudBusy(false);
      }
    } else {
      setIsConnectModalOpen(true);
    }
  };

  const handleConnected = async () => {
    try {
      await convertProjectToCloud(project.id);
      toast({
        title: 'Converted to cloud',
        description: `'${project.name}' is now syncing to the cloud.`,
      });
      if (onOpenChange) onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Conversion failed',
        description:
          error instanceof Error ? error.message : 'Could not convert project.',
        variant: 'destructive',
      });
    }
  };

  if (!project) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update the details for your project. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>

        <ProjectForm
          projectName={projectName}
          projectColor={projectColor}
          onNameChange={setProjectName}
          onColorChange={setProjectColor}
          projectId={project.id}
        />

        <DialogFooter className='sm:justify-between'>
          <DeleteProjectConfirmation
            project={project}
            onDeleteConfirmed={handleDeleteConfirmed}
          />
          <div className='flex gap-2'>
            <DialogClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogClose>
            <Button type='submit' onClick={handleSubmit}>
              Save Changes
            </Button>
          </div>
        </DialogFooter>

        {!project.cloudEnabled && (
          <div className='mt-2 rounded-md border border-dashed p-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium'>
                  Sync this project to cloud
                </p>
                <p className='text-xs text-muted-foreground'>
                  {cloudSyncEnabled
                    ? 'Keep this project backed up and synced across devices.'
                    : 'Connect a cloud account to start syncing this project.'}
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                onClick={handleSyncToCloud}
                disabled={cloudBusy}
                className='shrink-0'
              >
                <CloudUpload className='mr-2 h-4 w-4' />
                {cloudSyncEnabled ? 'Sync to cloud' : 'Connect & sync'}
              </Button>
            </div>
          </div>
        )}

        <CloudSyncConnectModal
          isOpen={isConnectModalOpen}
          onOpenChange={setIsConnectModalOpen}
          onConnected={handleConnected}
          title='Connect to sync this project'
          description='Sign in or create an account to sync this project with the cloud. Your data stays on the Cloudflare Worker you configured.'
        />
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectModal;
