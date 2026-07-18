import type { TaskPriority } from '@/types/tasks';

export type RangeKey = '7d' | '30d' | 'all';

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

export const priorityColors: Record<TaskPriority, string> = {
  low: '#3b82f6',
  medium: '#eab308',
  high: '#f97316',
  urgent: '#ef4444',
};

export const statusColors: Record<string, string> = {
  todo: '#6b7280',
  'in-progress': '#3b82f6',
  blocked: '#a855f7',
  completed: '#22c55e',
  cancelled: '#9ca3af',
};

export const categoryPalette = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#eab308',
  '#ec4899',
];

export const chartAxisColor = 'hsl(var(--muted-foreground))';
export const chartGridColor = 'hsl(var(--border))';
export const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--foreground))',
  fontSize: 12,
};
