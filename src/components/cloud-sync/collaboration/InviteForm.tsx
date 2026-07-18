'use client';

import { Copy, Check, Loader2, UserPlus } from 'lucide-react';
import type { CloudInvitation, CloudRole } from '@/lib/cloudflareSync/types';
import { createProjectInviteCode } from '@/lib/cloudflareSync/orchestrator';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Roles an admin may grant via invite. Owner is server-restricted. */
const INVITE_ROLES: CloudRole[] = ['editor', 'admin', 'viewer'];

interface InviteFormProps {
  projectId: string;
  inviteRole: CloudRole;
  inviteEmail: string;
  createdInvite: CloudInvitation | null;
  copied: boolean;
  busyInvite: boolean;
  setInviteRole: (role: CloudRole) => void;
  setInviteEmail: (email: string) => void;
  setCreatedInvite: (invite: CloudInvitation | null) => void;
  setCopied: (copied: boolean) => void;
  setBusyInvite: (busy: boolean) => void;
  setError: (message: string | null) => void;
}

export function InviteForm({
  projectId,
  inviteRole,
  inviteEmail,
  createdInvite,
  copied,
  busyInvite,
  setInviteRole,
  setInviteEmail,
  setCreatedInvite,
  setCopied,
  setBusyInvite,
  setError,
}: InviteFormProps) {
  const { toast } = useToast();

  const handleCreateInvite = async () => {
    setBusyInvite(true);
    setError(null);
    try {
      const invite = await createProjectInviteCode(projectId, {
        role: inviteRole,
        email: inviteEmail.trim() || null,
      });
      setCreatedInvite(invite);
      setCopied(false);
      toast({
        title: 'Invite created',
        description: 'Share the code with someone to add them to this project.',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite.');
    } finally {
      setBusyInvite(false);
    }
  };

  const handleCopy = async () => {
    if (!createdInvite) return;
    try {
      await navigator.clipboard.writeText(createdInvite.code);
      setCopied(true);
    } catch {
      // clipboard may be unavailable; the code is still visible to select.
    }
  };

  return (
    <div className='space-y-2 rounded-md border p-3'>
      <Label className='text-sm font-medium'>Invite someone</Label>
      <div className='flex flex-wrap items-end gap-2'>
        <div className='flex-1 min-w-[160px] space-y-1'>
          <Label
            htmlFor='invite-email'
            className='text-xs text-muted-foreground'
          >
            Email (optional)
          </Label>
          <Input
            id='invite-email'
            type='email'
            placeholder='teammate@example.com'
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={busyInvite}
          />
        </div>
        <div className='space-y-1'>
          <Label
            htmlFor='invite-role'
            className='text-xs text-muted-foreground'
          >
            Role
          </Label>
          <Select
            value={inviteRole}
            onValueChange={(v) => setInviteRole(v as CloudRole)}
            disabled={busyInvite}
          >
            <SelectTrigger id='invite-role' className='w-[130px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITE_ROLES.map((r) => (
                <SelectItem key={r} value={r} className='capitalize'>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCreateInvite} disabled={busyInvite}>
          {busyInvite ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <UserPlus className='mr-2 h-4 w-4' />
          )}
          Create invite
        </Button>
      </div>

      {createdInvite && (
        <div className='flex items-center gap-2 rounded-md bg-secondary/60 p-2'>
          <code className='flex-1 truncate text-xs'>{createdInvite.code}</code>
          <Button size='sm' variant='outline' onClick={handleCopy}>
            {copied ? (
              <Check className='mr-1.5 h-3.5 w-3.5 text-green-500' />
            ) : (
              <Copy className='mr-1.5 h-3.5 w-3.5' />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
      <p className='text-xs text-muted-foreground'>
        Recipients join from Settings → “Join a project” using this code.
      </p>
    </div>
  );
}
