import { Circle, Timer, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { TaskStatus } from '@/types/tasks';

// Status configuration for Kanban columns
export interface KanbanColumnConfig {
  status: TaskStatus;
  title: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const kanbanColumns: KanbanColumnConfig[] = [
  {
    status: 'todo',
    title: 'To Do',
    color: 'bg-gray-50 border-gray-200',
    icon: Circle,
  },
  {
    status: 'in-progress',
    title: 'In Progress',
    color: 'bg-blue-50 border-blue-200',
    icon: Timer,
  },
  {
    status: 'blocked',
    title: 'Blocked',
    color: 'bg-red-50 border-red-200',
    icon: AlertCircle,
  },
  {
    status: 'completed',
    title: 'Completed',
    color: 'bg-green-50 border-green-200',
    icon: CheckCircle2,
  },
];
