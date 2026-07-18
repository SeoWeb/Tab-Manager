'use client';

import { UserMinus } from 'lucide-react';
import type { CloudMember, CloudRole } from '@/lib/cloudflareSync/types';
import { CLOUD_ROLES } from '@/lib/cloudflareSync/roles';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function MemberRow({
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
