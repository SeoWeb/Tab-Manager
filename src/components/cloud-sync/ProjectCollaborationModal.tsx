'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Copy,
  Check,
  Loader2,
  UserMinus,
  UserPlus,
  AlertCircle,
  History,
  Users,
} from 'lucide-react';
import type { Project } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { CloudSyncApiError } from '@/lib/cloudflareSync/client';
import {
  fetchProjectMembers,
  createProjectInviteCode,
  changeMemberRole,
  removeProjectMemberById,
  fetchProjectActivity,
} from '@/lib/cloudflareSync/orchestrator';
import {
  canManageMembers,
  canEdit as canEditRole,
  isOwner,
  CLOUD_ROLES,
} from '@/lib/cloudflareSync/roles';
import type {
  CloudInvitation,
  CloudMember,
  CloudRole,
  CloudSyncChange,
} from '@/lib/cloudflareSync/types';

interface ProjectCollaborationModalProps {
  project: Project;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Roles an admin may grant via invite. Owner is server-restricted. */
const INVITE_ROLES: CloudRole[] = ['editor', 'admin', 'viewer'];

export function ProjectCollaborationModal({
  project,
  isOpen,
  onOpenChange,
}: ProjectCollaborationModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Users className='h-5 w-5' />
            Share &amp; Members
          </DialogTitle>
          <DialogDescription>
            Invite people to <strong>{project.name}</strong>, manage their
            roles, and review recent activity.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue='activity' className='w-full'>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='activity' className='gap-1.5'>
              <History className='h-4 w-4' />
              Activity
            </TabsTrigger>
            <TabsTrigger value='members' className='gap-1.5'>
              <Users className='h-4 w-4' />
              Members
            </TabsTrigger>
          </TabsList>
          <TabsContent value='activity'>
            <ActivityTab project={project} isActive={isOpen} />
          </TabsContent>
          <TabsContent value='members'>
            <MembersTab project={project} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab({ project }: { project: Project }) {
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

  const handleCreateInvite = async () => {
    setBusyInvite(true);
    setError(null);
    try {
      const invite = await createProjectInviteCode(project.id, {
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
              <code className='flex-1 truncate text-xs'>
                {createdInvite.code}
              </code>
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

function MemberRow({
  member,
  isSelf,
  canManage,
  canRemove,
  busy,
  onRoleChange,
  onRemove,
}: {
  member: CloudMember;
  isSelf: boolean;
  canManage: boolean;
  canRemove: boolean;
  busy: boolean;
  onRoleChange: (role: CloudRole) => void;
  onRemove: () => void;
}) {
  const initials = (member.display_name || member.email || '?')
    .slice(0, 2)
    .toUpperCase();

  return (
    <li className='flex items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary/40'>
      <Avatar className='h-8 w-8'>
        <AvatarFallback className='text-xs'>{initials}</AvatarFallback>
      </Avatar>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>
          {member.display_name || member.email}
          {isSelf && (
            <span className='ml-1.5 text-xs text-muted-foreground'>(you)</span>
          )}
        </p>
        <p className='truncate text-xs text-muted-foreground'>{member.email}</p>
      </div>

      {/* Owner role is fixed; you can never change your own role. */}
      {member.role === 'owner' ? (
        <Badge variant='secondary' className='capitalize'>
          owner
        </Badge>
      ) : (
        <Select
          value={member.role}
          onValueChange={(v) => onRoleChange(v as CloudRole)}
          disabled={!canManage || isSelf || busy}
        >
          <SelectTrigger className='h-8 w-[120px] capitalize'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLOUD_ROLES.filter((r) => r !== 'owner').map((r) => (
              <SelectItem key={r} value={r} className='capitalize'>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Only the owner may remove members, and never themselves. */}
      {canRemove && !isSelf && member.role !== 'owner' && (
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8 text-muted-foreground hover:text-destructive'
          onClick={onRemove}
          disabled={busy}
          aria-label='Remove member'
        >
          <UserMinus className='h-4 w-4' />
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Activity tab (read-only for all roles)
// ---------------------------------------------------------------------------

function ActivityTab({
  project,
  isActive,
}: {
  project: Project;
  isActive: boolean;
}) {
  const [changes, setChanges] = useState<CloudSyncChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChanges(await fetchProjectActivity(project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity.');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void load().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [isActive, load]);

  if (error) return <ErrorRow message={error} />;
  if (loading && changes.length === 0) {
    return (
      <div className='flex items-center justify-center py-6 text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Loading activity…
      </div>
    );
  }
  if (changes.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No activity yet.
      </p>
    );
  }

  return (
    <div className='flex flex-col'>
      <div className='mb-2 flex items-center justify-end'>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 gap-1.5 text-xs'
          onClick={() => void load()}
          disabled={loading}
        >
          <Loader2 className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <ScrollArea className='max-h-[320px]'>
        <ol className='space-y-1'>
          {changes.map((change) => (
            <li
              key={change.id}
              className='flex items-start gap-2 rounded-md px-2 py-1.5 text-sm'
            >
              <span className='mt-0.5'>
                <OperationIcon operation={change.operation} />
              </span>
              <div className='min-w-0 flex-1'>
                <p className='text-foreground'>
                  <span className='font-medium'>
                    {describeOperation(change.operation)}
                  </span>{' '}
                  a {change.entity_type}
                  {change.client_mutation_id ? '' : ' (server-side)'}
                </p>
                <p
                  className='text-xs text-muted-foreground'
                  title={formatAbsolute(change.created_at)}
                >
                  by {describeActor(change)} ·{' '}
                  {formatRelative(change.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

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

function OperationIcon({
  operation,
}: {
  operation: CloudSyncChange['operation'];
}) {
  const cls = 'h-3.5 w-3.5';
  if (operation === 'create')
    return <UserPlus className={`${cls} text-green-500`} />;
  if (operation === 'delete')
    return <UserMinus className={`${cls} text-destructive`} />;
  return <History className={`${cls} text-muted-foreground`} />;
}

function describeOperation(op: CloudSyncChange['operation']): string {
  switch (op) {
    case 'create':
      return 'Added';
    case 'update':
      return 'Updated';
    case 'delete':
      return 'Deleted';
    default:
      return 'Changed';
  }
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Human-readable actor label, preferring display name then email. */
function describeActor(change: CloudSyncChange): string {
  const name = change.actor_display_name?.trim();
  if (name) return name;
  if (change.actor_email) return change.actor_email;
  return shortId(change.actor_id);
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
