'use client';

import { useState } from 'react';
import { Cloud, RefreshCw, Loader2, Plus, CheckCircle2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import {
  discoverCloudProjects,
  importCloudProject,
} from '@/lib/cloudflareSync/orchestrator';
import type { CloudProject, CloudRole } from '@/lib/cloudflareSync/types';

/** A cloud project the user is a member of but hasn't added to this device yet. */
type DiscoverableProject = CloudProject & { role: CloudRole };

/**
 * "Your Cloud Projects" card for the Settings view. Lists cloud projects the
 * signed-in user is ALREADY a member of (via `GET /projects`) but that aren't on
 * this device yet, and lets them add any/all of them.
 *
 * This is the path a fresh client (the web frontend, or a second browser) uses to
 * reach a project the user joined elsewhere — invite codes are single-use, so the
 * "Join a Project" card can't reuse a code that was already accepted on another
 * device. Membership is global; this just materializes it locally.
 *
 * Shown only while cloud sync is connected.
 */
export function CloudSyncMyProjectsCard() {
  const isConnected = useAppStore((state) => !!state.cloudSync.account);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const { toast } = useToast();

  const [items, setItems] = useState<DiscoverableProject[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importingAll, setImportingAll] = useState(false);

  if (!isConnected) return null;

  const handleFind = async () => {
    setLoading(true);
    try {
      const found = await discoverCloudProjects();
      setItems(found);
      setSearched(true);
      if (found.length === 0) {
        toast({
          title: 'All caught up',
          description:
            'Every cloud project you belong to is already on this device.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (project: DiscoverableProject) => {
    setImportingId(project.id);
    try {
      const local = await importCloudProject(project);
      if (local) {
        setItems((prev) => prev.filter((p) => p.id !== project.id));
        toast({
          title: 'Project added',
          description: `“${local.name}” is now available on this device.`,
        });
        setActiveProject(local.id);
        setActiveView('projectDetail');
      } else {
        const lastError = useAppStore.getState().cloudSync.lastError;
        toast({
          title: 'Could not add project',
          description: lastError ?? 'Try again in a moment.',
          variant: 'destructive',
        });
      }
    } finally {
      setImportingId(null);
    }
  };

  const handleAddAll = async () => {
    if (items.length === 0) return;
    setImportingAll(true);
    let added = 0;
    try {
      // Import sequentially so per-project sync status stays coherent.
      for (const project of items) {
        // eslint-disable-next-line no-await-in-loop
        const local = await importCloudProject(project);
        if (local) added += 1;
      }
      setItems([]);
      toast({
        title: added === items.length ? 'Projects added' : 'Partially added',
        description:
          added === items.length
            ? `Added ${added} project${added === 1 ? '' : 's'} to this device.`
            : `Added ${added} of ${items.length}. Check sync status for details.`,
      });
    } finally {
      setImportingAll(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <Cloud className='h-5 w-5 text-muted-foreground' />
            <div>
              <CardTitle className='text-base'>Your Cloud Projects</CardTitle>
              <CardDescription>
                Add projects you already belong to in the cloud to this device.
              </CardDescription>
            </div>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={handleFind}
            disabled={loading || importingAll}
          >
            {loading ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <RefreshCw className='mr-2 h-4 w-4' />
            )}
            Find projects
          </Button>
        </div>
      </CardHeader>
      <CardContent className='space-y-2'>
        {items.length === 0 ? (
          <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            {searched ? (
              <>
                <CheckCircle2 className='h-4 w-4' />
                No new cloud projects to add.
              </>
            ) : (
              'Click “Find projects” to discover projects you belong to.'
            )}
          </p>
        ) : (
          <>
            {items.map((project) => (
              <div
                key={project.id}
                className='flex items-center justify-between gap-3 rounded-md border p-3'
              >
                <div className='flex min-w-0 items-center gap-2'>
                  <span
                    className='h-3 w-3 shrink-0 rounded-full border'
                    style={{ backgroundColor: project.color ?? '#CCCCCC' }}
                    aria-hidden
                  />
                  <div className='min-w-0'>
                    <div className='truncate text-sm font-medium'>
                      {project.name}
                    </div>
                    <Badge variant='secondary' className='mt-1 capitalize'>
                      {project.role}
                    </Badge>
                  </div>
                </div>
                <Button
                  size='sm'
                  onClick={() => handleAdd(project)}
                  disabled={importingAll || importingId === project.id}
                >
                  {importingId === project.id ? (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  ) : (
                    <Plus className='mr-2 h-4 w-4' />
                  )}
                  Add
                </Button>
              </div>
            ))}
            {items.length > 1 && (
              <Button
                variant='outline'
                className='w-full'
                onClick={handleAddAll}
                disabled={importingAll || importingId !== null}
              >
                {importingAll ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <Plus className='mr-2 h-4 w-4' />
                )}
                Add all ({items.length})
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
