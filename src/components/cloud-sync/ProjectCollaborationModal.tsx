'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { History, Users } from 'lucide-react';
import type { Project } from '@/types';
import { MembersTab } from '@/components/cloud-sync/collaboration/MembersTab';
import { ActivityTab } from '@/components/cloud-sync/collaboration/ActivityTab';

interface ProjectCollaborationModalProps {
  project: Project;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

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
