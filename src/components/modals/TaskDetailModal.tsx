'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { fetchProjectMembers } from '@/lib/cloudflareSync';
import type { CloudMember, CloudAccount } from '@/lib/cloudflareSync/types';
import { marked } from 'marked';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import { Archive, Pencil } from 'lucide-react';
import { SubtasksSection } from '@/components/modals/task-detail/SubtasksSection';
import { CommentsSection } from '@/components/modals/task-detail/CommentsSection';
import { TaskDetailAside } from '@/components/modals/task-detail/TaskDetailAside';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: AdvancedTask | null;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
}

export default function TaskDetailModal({
  isOpen,
  onClose,
  task,
  onEdit,
  onView,
}: TaskDetailModalProps) {
  const tasks = useAppStoreWithDefaults((state) => state.tasks, []);
  const addTaskComment = useAppStoreWithDefaults(
    (state) => state.addTaskComment,
    () => {}
  );
  const updateTask = useAppStoreWithDefaults(
    (state) => state.updateTask,
    () => {}
  );
  const addSubtask = useAppStoreWithDefaults(
    (state) => state.addSubtask,
    () => {}
  );
  const [newComment, setNewComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');

  const projects = useAppStoreWithDefaults((state) => state.projects, []);
  const project = projects.find((p) => p.id === task?.projectId);
  const cloudSync = useAppStoreWithDefaults((state) => state.cloudSync, {
    enabled: false,
    status: 'idle' as const,
    lastSyncedAt: null,
    lastReconciledAt: null,
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
  const [members, setMembers] = useState<CloudMember[]>([]);

  useEffect(() => {
    if (task?.projectId && project?.cloudEnabled && cloudSync.enabled) {
      fetchProjectMembers(task.projectId)
        .then(setMembers)
        .catch((err) => console.error('Failed to fetch project members', err));
    } else {
      setMembers([]);
    }
  }, [task?.projectId, project?.cloudEnabled, cloudSync.enabled]);

  const assignedMember = useMemo(() => {
    if (!task?.assignee) return null;
    return members.find((m) => m.user_id === task.assignee) || null;
  }, [task?.assignee, members]);

  const subtasks = useMemo(
    () =>
      task
        ? task.subtasks
            .map((subtaskId) => tasks.find((t) => t.id === subtaskId))
            .filter((t): t is AdvancedTask => !!t)
        : [],
    [task, tasks]
  );

  const parentTask = useMemo(
    () =>
      task && task.parentTaskId
        ? (tasks.find((t) => t.id === task.parentTaskId) ?? null)
        : null,
    [task, tasks]
  );

  const descriptionHtml = useMemo(() => {
    if (!task?.description) return '';
    try {
      return marked(task.description, { async: false });
    } catch (e) {
      console.error('Failed to parse markdown:', e);
      return task.description;
    }
  }, [task?.description]);

  if (!task) return null;

  const handleAddComment = () => {
    if (newComment.trim() && task) {
      addTaskComment(task.id, newComment.trim(), 'User');
      setNewComment('');
    }
  };

  const handleAddSubtask = () => {
    if (newSubtask.trim() && task) {
      const subtaskData: Omit<
        AdvancedTask,
        'id' | 'createdAt' | 'updatedAt' | 'activities' | 'parentTaskId'
      > = {
        title: newSubtask.trim(),
        status: 'todo',
        priority: task.priority,
        category: task.category,
        projectId: task.projectId,
        tags: [],
        subtasks: [],
        attachments: [],
        notes: '',
        reminders: [],
        progress: 0,
        comments: [],
        isArchived: false,
        isFavorite: false,
        customFields: {},
      };
      addSubtask(task.id, subtaskData);
      setNewSubtask('');
    }
  };

  const handleSubtaskStatusChange = (subtaskId: string, status: TaskStatus) => {
    updateTask(subtaskId, { status });
  };

  const handleEditClick = () => {
    onEdit(task);
    onClose();
  };

  const handleArchive = () => {
    if (task) {
      updateTask(task.id, { isArchived: true });
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='w-[92vw] sm:max-w-4xl h-[90vh] flex flex-col p-0'>
        <DialogHeader className='p-4 border-b flex flex-row justify-between items-center'>
          <DialogTitle className='flex items-center gap-2'>
            <span>{task.title}</span>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6'
              onClick={handleEditClick}
            >
              <Pencil className='h-4 w-4' />
            </Button>
          </DialogTitle>
          <DialogDescription className='sr-only'>
            Task details for {task.title}
          </DialogDescription>
          {task.status === 'completed' && (
            <Button variant='outline' size='sm' onClick={handleArchive}>
              <Archive className='h-4 w-4 mr-2' />
              Archive
            </Button>
          )}
        </DialogHeader>
        <div className='flex-1 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-3 gap-0'>
          <div className='p-4 md:p-6 md:col-span-2 md:h-full md:overflow-y-auto space-y-6'>
            <div>
              <h3 className='font-semibold mb-2'>Description</h3>
              {task.description ? (
                <div
                  className='text-sm text-muted-foreground markdown-content'
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
              ) : (
                <p className='text-sm text-muted-foreground italic'>
                  No description provided.
                </p>
              )}
            </div>

            <Separator />

            <SubtasksSection
              subtasks={subtasks}
              newSubtask={newSubtask}
              onNewSubtaskChange={setNewSubtask}
              onAddSubtask={handleAddSubtask}
              onSubtaskStatusChange={handleSubtaskStatusChange}
              onView={onView}
            />

            <Separator />

            <CommentsSection
              comments={task.comments}
              newComment={newComment}
              onNewCommentChange={setNewComment}
              onAddComment={handleAddComment}
            />
          </div>

          <TaskDetailAside
            task={task}
            project={project}
            members={members}
            currentUser={currentUser}
            assignedMember={assignedMember}
            parentTask={parentTask}
            onUpdate={updateTask}
            onView={onView}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
