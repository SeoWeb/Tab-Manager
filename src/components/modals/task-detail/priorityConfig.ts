import {
  Circle,
  AlertCircle,
  Flag,
  Zap,
  Archive,
  Timer as TimerIcon,
  CheckCircle2,
} from 'lucide-react';
import type { TaskPriority, TaskStatus } from '@/types/tasks';

export interface PriorityConfigEntry {
  color: string;
  bgColor: string;
  icon: React.ElementType;
  label: string;
}

export const priorityConfig: Record<TaskPriority, PriorityConfigEntry> = {
  low: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    icon: Circle,
    label: 'Low',
  },
  medium: {
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50',
    icon: AlertCircle,
    label: 'Medium',
  },
  high: {
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    icon: Flag,
    label: 'High',
  },
  urgent: {
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    icon: Zap,
    label: 'Urgent',
  },
};

export const statusConfig: Record<
  TaskStatus,
  { color: string; bgColor: string; icon: React.ElementType; label: string }
> = {
  todo: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Circle,
    label: 'To Do',
  },
  'in-progress': {
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
    icon: TimerIcon,
    label: 'In Progress',
  },
  blocked: {
    color: 'text-red-500',
    bgColor: 'bg-red-100',
    icon: AlertCircle,
    label: 'Blocked',
  },
  completed: {
    color: 'text-green-500',
    bgColor: 'bg-green-100',
    icon: CheckCircle2,
    label: 'Completed',
  },
  cancelled: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Circle,
    label: 'Cancelled',
  },
  archived: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    icon: Archive,
    label: 'Archived',
  },
};
