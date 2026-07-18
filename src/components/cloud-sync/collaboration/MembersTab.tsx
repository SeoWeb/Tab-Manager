'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CloudMember } from '@/lib/cloudflareSync/types';
import { useAppStore } from '@/stores/appStore';
import { fetchProjectMembers } from '@/lib/cloudflareSync/orchestrator';
import {
  canManageMembers,
  canEdit as canEditRole,
  isOwner,
} from '@/lib/cloudflareSync/roles';
import type { Project } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { MemberRow } from '@/components/cloud-sync/collaboration/MemberRow';
import { InviteForm } from '@/components/cloud-sync/collaboration/InviteForm';
import type { CloudInvitation, CloudRole } from '@/lib/cloudflareSync/types';
import { CloudSyncApiError } from '@/lib/cloudflareSync/client';
import {
  changeMemberRole,
  removeProjectMemberById,
} from '@/lib/cloudflareSync/orchestrator';
import { useToast } from '@/hooks/use-toast';

function RoleBadge({ role }: { role: CloudRole | undefined }) {
  return (
    <div className='flex items-center gap-2 text-sm'>
      <span className='text-muted-foreground'>Your role:</span>
      <Badge variant='secondary' className='capitalize'>
        {role ?? 'unknown'}
      </Badge>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <p className='flex items-center gap-1.5 text-sm text-destructive'>
      <AlertCircle className='h-4 w-4' />
      {message}
    </p>
  );
}

export function MembersTab({ project }: { project: Project }) {
  const account = useAppStore((state) => state.cloudSync.account);
  const onlinePresence = useAppStore(
    (state) => state.cloudSync.onlinePresence ?? []
  );
  const realtimeConnected = useAppStore(
    (state) => state.cloudSync.realtimeConnected ?? false
  );
  const { toast } = useToast();

  const role = project.cloudRole;
  const manage = canManageMembers(role);

  const [members, setMembers] = useState<CloudMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteRole, setInviteRole] = useState<CloudRole>('editor');
  const [inviteEmail, setInviteEmail] = useState('');
  const [createdInvite, setCreatedInvite] = useState<CloudInvitation | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [busyInvite, setBusyInvite] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setMembers(await fetchProjectMembers(project.id));
    } catch (e) {
      if (e instanceof CloudSyncApiError && e.status === 403) {
        setForbidden(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load members.');
      }
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    // Only admins/owners can list members; for everyone else the backend
    // returns 403 and we render a read-only note instead of the table.
    if (manage) void loadMembers();
  }, [manage, loadMembers]);

  const handleRoleChange = async (member: CloudMember, next: CloudRole) => {
    setBusyMemberId(member.user_id);
    try {
      await changeMemberRole(project.id, member.user_id, next);
      toast({ title: 'Role updated' });
      await loadMembers();
    } catch (e) {
      toast({
        title: 'Could not change role',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemove = async (member: CloudMember) => {
    setBusyMemberId(member.user_id);
    try {
      await removeProjectMemberById(project.id, member.user_id);
      toast({
        title: 'Member removed',
        description: member.display_name ?? member.email,
      });
      await loadMembers();
    } catch (e) {
      toast({
        title: 'Could not remove member',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyMemberId(null);
    }
  };

  return (
    <div className='space-y-4'>
      <RoleBadge role={role} />

      {/* Online presence (Phase 5 realtime). Read-only; reflects who currently
          has this project open over a realtime socket. */}
      {realtimeConnected && (
        <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <span className='inline-block h-1.5 w-1.5 rounded-full bg-green-500' />
          {onlinePresence.length > 0
            ? `${onlinePresence.length} online: ${onlinePresence
                .map((u) => u.displayName || 'member')
                .join(', ')}`
            : 'Realtime connected'}
        </div>
      )}

      {/* Invite creation — admins/owners only. */}
      {manage && !forbidden && (
        <InviteForm
          projectId={project.id}
          inviteRole={inviteRole}
          inviteEmail={inviteEmail}
          createdInvite={createdInvite}
          copied={copied}
          busyInvite={busyInvite}
          setInviteRole={setInviteRole}
          setInviteEmail={setInviteEmail}
          setCreatedInvite={setCreatedInvite}
          setCopied={setCopied}
          setBusyInvite={setBusyInvite}
          setError={setError}
        />
      )}

      <Separator />

      {/* Members list. */}
      {/* A known non-admin role can't list members; show a note instead of an
          empty list. (undefined role = local/unsynced → attempt the fetch and
          let a 403 set `forbidden`.) */}
      {forbidden || (!!role && !manage) ? (
        <p className='text-sm text-muted-foreground'>
          Only project admins can view and manage members. You can still read
          and
          {canEditRole(role) ? ' edit' : ' read'} this project&apos;s content.
        </p>
      ) : loading ? (
        <div className='flex items-center justify-center py-6 text-muted-foreground'>
          <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Loading members…
        </div>
      ) : error ? (
        <ErrorRow message={error} />
      ) : (
        <ScrollArea className='max-h-[280px]'>
          <ul className='space-y-1'>
            {members.map((member) => {
              const isSelf = account?.id === member.user_id;
              return (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  isSelf={!!isSelf}
                  canManage={manage}
                  canRemove={isOwner(role)}
                  busy={busyMemberId === member.user_id}
                  onRoleChange={(next) => handleRoleChange(member, next)}
                  onRemove={() => handleRemove(member)}
                />
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
