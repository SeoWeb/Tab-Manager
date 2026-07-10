'use client';

import { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import type { AdvancedTask, TaskPriority, TaskStatus } from '@/types/tasks';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { fetchProjectMembers } from '@/lib/cloudflareSync';
import { useFieldEditPresence } from '@/lib/cloudflareSync/useFieldLock';
import type {
  CloudMember,
  CloudAccount,
  CloudPresenceUser,
} from '@/lib/cloudflareSync/types';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    task:
      | Omit<AdvancedTask, 'id' | 'createdAt' | 'updatedAt' | 'activities'>
      | AdvancedTask
  ) => void;
  task?: AdvancedTask;
}

export default function TaskFormModal({
  isOpen,
  onClose,
  onSave,
  task,
}: TaskFormModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [category, setCategory] = useState('General');
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [assignee, setAssignee] = useState<string | undefined>(undefined);

  const activeProjectId = useAppStoreWithDefaults(
    (state) => state.activeProjectId,
    null
  );
  const projects = useAppStoreWithDefaults((state) => state.projects, []);
  const cloudSync = useAppStoreWithDefaults((state) => state.cloudSync, {
    enabled: false,
    status: 'idle' as const,
    lastSyncedAt: null,
    lastError: null,
    pendingMutationCount: 0,
    account: null as CloudAccount | null,
    apiBaseUrl: '',
    cursors: {},
    realtimeConnected: false,
    onlinePresence: [],
    pendingEdits: {},
  });
  const currentUser = cloudSync.account;

  const currentProjectId =
    task?.projectId || activeProjectId || projects[0]?.id;
  const project = projects.find((p) => p.id === currentProjectId);
  const [members, setMembers] = useState<CloudMember[]>([]);

  useEffect(() => {
    if (currentProjectId && project?.cloudEnabled && cloudSync.enabled) {
      fetchProjectMembers(currentProjectId)
        .then(setMembers)
        .catch((err) => console.error('Failed to fetch project members', err));
    } else {
      setMembers([]);
    }
  }, [currentProjectId, project?.cloudEnabled, cloudSync.enabled]);

  // Co-editing presence: broadcast which field we're editing on focus, and show
  // a soft-lock badge when a different collaborator is editing the same field.
  const editingId = task?.id;
  const titleLock = useFieldEditPresence(editingId, 'title');
  const descriptionLock = useFieldEditPresence(editingId, 'description');
  const priorityLock = useFieldEditPresence(editingId, 'priority');
  const statusLock = useFieldEditPresence(editingId, 'status');
  const categoryLock = useFieldEditPresence(editingId, 'category');
  const dueDateLock = useFieldEditPresence(editingId, 'dueDate');
  const assigneeLock = useFieldEditPresence(editingId, 'assignee');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setCategory(task.category);
      setTags(task.tags || []);
      setDueDate(task.dueDate ? new Date(task.dueDate) : undefined);
      setAssignee(task.assignee);
    } else {
      // Reset form for new task
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setCategory('General');
      setTags([]);
      setDueDate(undefined);
      setAssignee(undefined);
    }
  }, [task]);

  const handleSave = () => {
    if (!title.trim()) {
      // Basic validation
      alert('Please enter a task title.');
      return;
    }

    const taskData: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities'
    > & { id?: string } = {
      ...(task || {}),
      title: title.trim(),
      description: description.trim(),
      priority,
      status,
      category,
      tags,
      dueDate,
      assignee,
      subtasks: task?.subtasks || [],
      attachments: task?.attachments || [],
      notes: task?.notes || '',
      reminders: task?.reminders || [],
      progress: task?.progress || 0,
      comments: task?.comments || [],
      isArchived: task?.isArchived || false,
      isFavorite: task?.isFavorite || false,
      customFields: task?.customFields || {},
    };

    onSave(taskData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='w-[92vw] sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Add New Task'}</DialogTitle>
          <DialogDescription>
            Fill in the details below to create or edit a task.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4 py-4'>
          <>
            <Input
              placeholder='Task title...'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className='font-medium'
              {...titleLock}
              disabled={titleLock.locked}
            />
            <LockBadge editor={titleLock.editor} />
          </>
          <>
            <Textarea
              placeholder='Description (optional)...'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className='min-h-[250px]'
              {...descriptionLock}
              disabled={descriptionLock.locked}
            />
            <LockBadge editor={descriptionLock.editor} />
          </>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <Select
              value={priority}
              onValueChange={(value: TaskPriority) => setPriority(value)}
            >
              <SelectTrigger {...priorityLock} disabled={priorityLock.locked}>
                <SelectValue placeholder='Priority' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='low'>Low</SelectItem>
                <SelectItem value='medium'>Medium</SelectItem>
                <SelectItem value='high'>High</SelectItem>
                <SelectItem value='urgent'>Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value: TaskStatus) => setStatus(value)}
            >
              <SelectTrigger {...statusLock} disabled={statusLock.locked}>
                <SelectValue placeholder='Status' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='todo'>To Do</SelectItem>
                <SelectItem value='in-progress'>In Progress</SelectItem>
                <SelectItem value='completed'>Completed</SelectItem>
                <SelectItem value='blocked'>Blocked</SelectItem>
                <SelectItem value='cancelled'>Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <Input
              placeholder='Category'
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              {...categoryLock}
              disabled={categoryLock.locked}
            />
            <Input
              placeholder='Tags (comma-separated)'
              value={tags.join(', ')}
              onChange={(e) =>
                setTags(e.target.value.split(',').map((tag) => tag.trim()))
              }
            />
          </div>
          {project?.cloudEnabled && (
            <div className='flex flex-col gap-2'>
              <label className='text-sm font-medium'>Assignee</label>
              <div className='flex gap-2'>
                <Select
                  value={assignee || 'unassigned'}
                  onValueChange={(value) =>
                    setAssignee(value === 'unassigned' ? undefined : value)
                  }
                >
                  <SelectTrigger className='flex-1' {...assigneeLock}>
                    <SelectValue placeholder='Select Assignee' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='unassigned'>Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.display_name || member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentUser && assignee !== currentUser.id && (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => setAssignee(currentUser.id)}
                  >
                    Assign to me
                  </Button>
                )}
              </div>
            </div>
          )}
          <div>
            <div className='flex items-center'>
              <label className='text-sm font-medium'>Due Date</label>
              <LockBadge editor={dueDateLock.editor} />
            </div>
            <div {...dueDateLock}>
              <DatePicker date={dueDate} setDate={setDueDate} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {task ? 'Save Changes' : 'Add Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LockBadge({ editor }: { editor?: CloudPresenceUser }) {
  if (!editor) return null;
  return (
    <span className='mt-1 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400'>
      <Lock className='h-3 w-3' />
      {editor.displayName} is editing this field
    </span>
  );
}
