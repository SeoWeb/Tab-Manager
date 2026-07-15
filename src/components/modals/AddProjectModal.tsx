import React, { useState } from 'react';
import { nanoid } from 'nanoid';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAddProject } from '@/hooks/useAppStoreWithDefaults';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import {
  addCloudProject,
  convertProjectToCloud,
} from '@/lib/cloudflareSync/orchestrator';
import { CloudSyncConnectModal } from '@/components/cloud-sync/CloudSyncConnectModal';
import ProjectForm from './ProjectForm';

interface AddProjectModalProps {
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AddProjectModal: React.FC<AddProjectModalProps> = ({
  children,
  isOpen,
  onOpenChange,
}) => {
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('#FFFFFF');
  const [syncToCloud, setSyncToCloud] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const addProject = useAddProject();
  const cloudEnabled = useAppStore((state) => state.cloudSync.enabled);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (projectName.trim() === '') {
      toast({
        title: 'Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    const projectInput = {
      name: projectName.trim(),
      color: projectColor,
    };

    // Cloud projects must be created server-side first (POST /projects) so the
    // local project uses the canonical server id. Falls back to a local project
    // if the create fails.
    if (syncToCloud && cloudEnabled) {
      setSaving(true);
      try {
        const created = await addCloudProject(projectInput);
        toast({
          title: created ? 'Cloud Project Added' : 'Cloud create failed',
          description: created
            ? `'${projectInput.name}' is syncing to the cloud.`
            : 'Could not create the cloud project. Check sync status in Settings.',
          variant: created ? 'default' : 'destructive',
        });
      } finally {
        setSaving(false);
      }
    } else if (syncToCloud && !cloudEnabled) {
      // Create the project locally first, then prompt the user to connect so it
      // can be converted to a cloud project once they sign in.
      const newId = nanoid();
      addProject(projectInput, { id: newId });
      setPendingProjectId(newId);
      setIsConnectModalOpen(true);
      toast({
        title: 'Project Added',
        description: `'${projectInput.name}' was created locally. Connect to sync it to the cloud.`,
      });
    } else {
      addProject(projectInput);
      toast({
        title: 'Project Added',
        description: `'${projectInput.name}' has been successfully added.`,
      });
    }

    setProjectName('');
    setProjectColor('#FFFFFF');
    setSyncToCloud(false);
    if (onOpenChange) {
      onOpenChange(false);
    }
  };

  const handleConnected = async () => {
    if (!pendingProjectId) return;
    try {
      await convertProjectToCloud(pendingProjectId);
      toast({
        title: 'Synced to cloud',
        description: 'Your new project is now syncing to the cloud.',
      });
    } catch (error) {
      toast({
        title: 'Sync failed',
        description:
          error instanceof Error
            ? error.message
            : 'Could not sync the project.',
        variant: 'destructive',
      });
    } finally {
      setPendingProjectId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Add New Project</DialogTitle>
          <DialogDescription>
            Enter the details for your new project. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>

        <ProjectForm
          projectName={projectName}
          projectColor={projectColor}
          onNameChange={setProjectName}
          onColorChange={setProjectColor}
          projectId='new-project'
        />

        <div className='flex items-start gap-2'>
          <Checkbox
            id='sync-to-cloud'
            checked={syncToCloud}
            onCheckedChange={(checked) => setSyncToCloud(checked === true)}
            disabled={saving}
            className='mt-0.5'
          />
          <div className='space-y-0.5'>
            <Label htmlFor='sync-to-cloud' className='text-sm font-medium'>
              Sync this project to cloud
            </Label>
            <p className='text-xs text-muted-foreground'>
              {cloudEnabled
                ? 'Creates the project on your Cloudflare Worker and keeps it synced.'
                : 'You will be prompted to connect a cloud account after creating the project.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline' disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type='submit' onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save Project'}
          </Button>
        </DialogFooter>

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

export default AddProjectModal;
