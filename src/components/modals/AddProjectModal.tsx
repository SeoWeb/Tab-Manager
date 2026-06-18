import React, { useState } from 'react';
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
import { addCloudProject } from '@/lib/cloudflareSync/orchestrator';
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
            disabled={!cloudEnabled || saving}
            className='mt-0.5'
          />
          <div className='space-y-0.5'>
            <Label htmlFor='sync-to-cloud' className='text-sm font-medium'>
              Sync this project to cloud
            </Label>
            <p className='text-xs text-muted-foreground'>
              {cloudEnabled
                ? 'Creates the project on your Cloudflare Worker and keeps it synced.'
                : 'Connect cloud sync in Settings first to enable this option.'}
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
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectModal;
