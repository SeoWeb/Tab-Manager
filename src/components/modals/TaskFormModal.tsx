'use client';

import { useState, useEffect } from 'react';
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
} from '@/components/ui/dialog';
import type { AdvancedTask, TaskPriority, TaskStatus } from '@/types/tasks';

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

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setCategory(task.category);
      setTags(task.tags || []);
      setDueDate(task.dueDate ? new Date(task.dueDate) : undefined);
    } else {
      // Reset form for new task
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setCategory('General');
      setTags([]);
      setDueDate(undefined);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Add New Task'}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4 py-4'>
          <Input
            placeholder='Task title...'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className='font-medium'
          />
          <Textarea
            placeholder='Description (optional)...'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className='grid grid-cols-2 gap-4'>
            <Select
              value={priority}
              onValueChange={(value: TaskPriority) => setPriority(value)}
            >
              <SelectTrigger>
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
              <SelectTrigger>
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
          <div className='grid grid-cols-2 gap-4'>
            <Input
              placeholder='Category'
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              placeholder='Tags (comma-separated)'
              value={tags.join(', ')}
              onChange={(e) =>
                setTags(e.target.value.split(',').map((tag) => tag.trim()))
              }
            />
          </div>
          <div>
            <label className='text-sm font-medium'>Due Date</label>
            <DatePicker date={dueDate} setDate={setDueDate} />
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
