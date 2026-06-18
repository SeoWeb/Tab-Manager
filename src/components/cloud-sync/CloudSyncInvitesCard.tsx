'use client';

import { useState } from 'react';
import { UserPlus, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { acceptInviteCode } from '@/lib/cloudflareSync/orchestrator';

/**
 * "Join a project" card for the Settings view. The user pastes an invite code
 * (shared by a project admin) to become a member of that cloud project. On
 * success the project is materialized locally and selected.
 *
 * Shown only while cloud sync is connected.
 */
export function CloudSyncInvitesCard() {
  const isConnected = useAppStore((state) => !!state.cloudSync.account);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isConnected) return null;

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const project = await acceptInviteCode(trimmed);
      if (project) {
        toast({
          title: 'Joined project',
          description: `You can now collaborate on “${project.name}”.`,
        });
        setActiveProject(project.id);
        setActiveView('projectDetail');
        setCode('');
      } else {
        // acceptInviteCode surfaces the reason via cloudSync.lastError.
        const lastError = useAppStore.getState().cloudSync.lastError;
        toast({
          title: 'Could not join',
          description: lastError ?? 'Check the code and try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-2'>
          <UserPlus className='h-5 w-5 text-muted-foreground' />
          <div>
            <CardTitle className='text-base'>Join a Project</CardTitle>
            <CardDescription>
              Enter an invite code shared with you to join a cloud project.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-end gap-2'>
          <div className='flex-1 space-y-1'>
            <Label htmlFor='invite-code' className='sr-only'>
              Invite code
            </Label>
            <Input
              id='invite-code'
              placeholder='Paste invite code'
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void handleJoin();
              }}
            />
          </div>
          <Button onClick={handleJoin} disabled={busy || !code.trim()}>
            {busy ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <UserPlus className='mr-2 h-4 w-4' />
            )}
            Join
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
